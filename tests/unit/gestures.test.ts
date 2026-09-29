import { describe, expect, it } from 'vitest';
import {
	RESET_CODES,
	ZOOM_IN_CODES,
	ZOOM_OUT_CODES,
	classify,
	hasPrimaryModifier,
	type KeyDescriptor,
} from '../../src/gestures.js';

/**
 * Build a key descriptor.
 * @param code - physical key code.
 * @param mods - modifier flags to set.
 * @returns the descriptor.
 */
function key(code: string, mods: Partial<Omit<KeyDescriptor, 'code'>> = {}): KeyDescriptor {
	return { code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

describe('gesture classification on Windows and Linux', () => {
	const windows = false;

	it('accepts the conventional pair', () => {
		expect(classify(key('Equal', { ctrlKey: true }), windows)).toEqual({ kind: 'step', step: 1 });
		expect(classify(key('Minus', { ctrlKey: true }), windows)).toEqual({ kind: 'step', step: -1 });
	});

	it('accepts the shifted spelling of the plus key', () => {
		expect(classify(key('Equal', { ctrlKey: true, shiftKey: true }), windows)).toEqual({
			kind: 'step',
			step: 1,
		});
	});

	it('accepts the numeric pad', () => {
		expect(classify(key('NumpadAdd', { ctrlKey: true }), windows)).toEqual({ kind: 'step', step: 1 });
		expect(classify(key('NumpadSubtract', { ctrlKey: true }), windows)).toEqual({
			kind: 'step',
			step: -1,
		});
	});

	it('accepts both reset spellings', () => {
		expect(classify(key('Digit0', { ctrlKey: true }), windows)).toEqual({ kind: 'reset' });
		expect(classify(key('Numpad0', { ctrlKey: true }), windows)).toEqual({ kind: 'reset' });
	});

	it('rejects a bare key', () => {
		for (const code of [...ZOOM_IN_CODES, ...ZOOM_OUT_CODES, ...RESET_CODES]) {
			expect(classify(key(code), windows)).toBeNull();
		}
	});

	it('rejects an unmodified Shift combination', () => {
		expect(classify(key('Equal', { shiftKey: true }), windows)).toBeNull();
	});

	it('rejects Alt, which the shell reserves', () => {
		expect(classify(key('Equal', { ctrlKey: true, altKey: true }), windows)).toBeNull();
		expect(classify(key('Minus', { ctrlKey: true, altKey: true }), windows)).toBeNull();
	});

	it('rejects Meta on Windows', () => {
		expect(classify(key('Equal', { metaKey: true }), windows)).toBeNull();
	});

	it('leaves unrelated commands alone', () => {
		expect(classify(key('KeyA', { ctrlKey: true }), windows)).toBeNull();
		expect(classify(key('KeyC', { ctrlKey: true }), windows)).toBeNull();
		expect(classify(key('KeyB', { ctrlKey: true }), windows)).toBeNull();
		expect(classify(key('Slash', { ctrlKey: true }), windows)).toBeNull();
	});
});

describe('gesture classification on macOS', () => {
	const mac = true;

	it('uses Meta as the primary modifier', () => {
		expect(classify(key('Equal', { metaKey: true }), mac)).toEqual({ kind: 'step', step: 1 });
		expect(classify(key('Minus', { metaKey: true }), mac)).toEqual({ kind: 'step', step: -1 });
	});

	it('ignores Control, which macOS reserves for cursor movement', () => {
		expect(classify(key('Equal', { ctrlKey: true }), mac)).toBeNull();
	});
});

describe('hasPrimaryModifier', () => {
	it('resolves per platform', () => {
		expect(hasPrimaryModifier(key('Equal', { ctrlKey: true }), false)).toBe(true);
		expect(hasPrimaryModifier(key('Equal', { metaKey: true }), false)).toBe(false);
		expect(hasPrimaryModifier(key('Equal', { metaKey: true }), true)).toBe(true);
		expect(hasPrimaryModifier(key('Equal', { ctrlKey: true }), true)).toBe(false);
	});
});

describe('the code tables', () => {
	it('overlap nowhere', () => {
		const all = [...ZOOM_IN_CODES, ...ZOOM_OUT_CODES, ...RESET_CODES];
		expect(new Set(all).size).toBe(all.length);
	});

	it('cover the spellings the documentation promises', () => {
		expect(ZOOM_IN_CODES).toEqual(expect.arrayContaining(['Equal', 'NumpadAdd']));
		expect(ZOOM_OUT_CODES).toEqual(expect.arrayContaining(['Minus', 'NumpadSubtract']));
		expect(RESET_CODES).toEqual(expect.arrayContaining(['Digit0', 'Numpad0']));
	});
});
