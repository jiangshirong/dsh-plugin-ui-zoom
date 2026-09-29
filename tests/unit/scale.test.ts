import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SCALE,
	MAX_SCALE,
	MIN_SCALE,
	SCALES,
	STORAGE_KEY,
	clamp,
	createStorage,
	nearestScale,
	parseStored,
	scaleIndex,
	scalePercent,
	stepScale,
} from '../../src/scale.js';

describe('the scale ladder', () => {
	it('is ordered, unique, and spans the documented range', () => {
		expect(SCALES).toEqual([...SCALES].sort((left, right) => left - right));
		expect(new Set(SCALES).size).toBe(SCALES.length);
		expect(MIN_SCALE).toBe(0.5);
		expect(MAX_SCALE).toBe(2);
		expect(SCALES).toContain(DEFAULT_SCALE);
	});

	it('clamps outside the range and rejects NaN', () => {
		expect(clamp(0.1)).toBe(MIN_SCALE);
		expect(clamp(9)).toBe(MAX_SCALE);
		expect(clamp(1.25)).toBe(1.25);
		expect(clamp(Number.NaN)).toBe(DEFAULT_SCALE);
	});

	it('snaps any value to the nearest rung', () => {
		expect(nearestScale(1.24)).toBe(1.25);
		expect(nearestScale(1.13)).toBe(1.1);
		expect(nearestScale(0)).toBe(MIN_SCALE);
		expect(nearestScale(99)).toBe(MAX_SCALE);
		expect(nearestScale(Number.NaN)).toBe(DEFAULT_SCALE);
	});

	it('reports rung indices for the whole ladder', () => {
		SCALES.forEach((scale, index) => {
			expect(scaleIndex(scale)).toBe(index);
		});
	});

	it('steps one rung and stops at both ends', () => {
		expect(stepScale(1, 1)).toBe(1.1);
		expect(stepScale(1, -1)).toBe(0.9);
		expect(stepScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
		expect(stepScale(MIN_SCALE, -1)).toBe(MIN_SCALE);
	});

	it('walks from the floor to the ceiling in whole steps', () => {
		const walked: number[] = [MIN_SCALE];
		let current = MIN_SCALE;
		for (let index = 1; index < SCALES.length; index++) {
			current = stepScale(current, 1);
			walked.push(current);
		}
		expect(walked).toEqual([...SCALES]);
		expect(stepScale(current, 1)).toBe(MAX_SCALE);
	});

	it('treats an off-ladder current value as its nearest rung', () => {
		// A hand-edited preference must not produce a stray scale.
		expect(stepScale(1.24, 1)).toBe(1.5);
		expect(stepScale(1.24, -1)).toBe(1.1);
	});

	it('renders whole percentages', () => {
		expect(scalePercent(1)).toBe(100);
		expect(scalePercent(0.5)).toBe(50);
		expect(scalePercent(1.25)).toBe(125);
		expect(scalePercent(1.24)).toBe(125);
	});
});

describe('parseStored', () => {
	it('accepts a stored rung', () => {
		expect(parseStored('1.25')).toBe(1.25);
	});

	it('falls back for absent, unparsable, or out-of-range values', () => {
		expect(parseStored(null)).toBe(DEFAULT_SCALE);
		expect(parseStored('')).toBe(DEFAULT_SCALE);
		expect(parseStored('wide')).toBe(DEFAULT_SCALE);
		expect(parseStored('NaN')).toBe(DEFAULT_SCALE);
		expect(parseStored('Infinity')).toBe(DEFAULT_SCALE);
	});

	it('clamps a stored value outside the ladder', () => {
		expect(parseStored('0.05')).toBe(MIN_SCALE);
		expect(parseStored('12')).toBe(MAX_SCALE);
	});

	it('reads only the leading number of a sloppy value', () => {
		expect(parseStored('1.5px')).toBe(1.5);
	});
});

describe('createStorage', () => {
	/**
	 * Build a fake store.
	 * @param initial - seed values.
	 * @returns the store and its calls.
	 */
	function store(initial: Record<string, string> = {}) {
		const values = new Map(Object.entries(initial));
		const writes: [string, string][] = [];
		return {
			values,
			writes,
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => {
				writes.push([key, value]);
				values.set(key, value);
			},
		};
	}

	it('writes under the documented key', () => {
		const fake = store();
		createStorage(fake.getItem, fake.setItem).write(1.25);
		expect(fake.writes).toEqual([[STORAGE_KEY, '1.25']]);
	});

	it('reads back what it wrote', () => {
		const fake = store();
		const storage = createStorage(fake.getItem, fake.setItem);
		storage.write(0.8);
		expect(storage.read()).toBe(0.8);
	});

	it('defaults when the store is empty', () => {
		const fake = store();
		expect(createStorage(fake.getItem, fake.setItem).read()).toBe(DEFAULT_SCALE);
	});

	it('survives a store that refuses to read', () => {
		const storage = createStorage(
			() => {
				throw new Error('blocked');
			},
			() => {},
		);
		expect(storage.read()).toBe(DEFAULT_SCALE);
	});

	it('survives a store that refuses to write', () => {
		const storage = createStorage(
			() => null,
			() => {
				throw new Error('quota');
			},
		);
		expect(() => storage.write(1.5)).not.toThrow();
	});
});
