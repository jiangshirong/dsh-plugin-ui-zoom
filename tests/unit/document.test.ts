import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyScale, clearScale, createReadout, setOverflowLock } from '../../src/document.js';
import type { Readout } from '../../src/document.js';

/** The id the overflow lock is stored under. */
const LOCK_ID = 'dsh-plugin-ui-zoom/overflow';

/**
 * A root element whose inline style is fully observable.
 *
 * jsdom's `CSSStyleDeclaration` has no `zoom` in its property database, so
 * neither `style.zoom = …` nor `getPropertyValue('zoom')` round-trips there.
 * The plugin's contract is about *which CSS property API it calls*, so that is
 * what these tests assert, via a recording style object. The real property is
 * exercised separately in a real browser by `tests/system/`.
 * @returns the element stand-in and its recorded calls.
 */
function recordingRoot() {
	const set = vi.fn();
	const remove = vi.fn();
	const style = {
		setProperty: (property: string, value: string) => {
			set(property, value);
		},
		removeProperty: (property: string) => {
			remove(property);
		},
	};
	return {
		element: { style } as unknown as HTMLElement,
		set,
		remove,
		/**
		 * The scale currently declared, derived from the recorded calls.
		 * @returns the value, or null when no declaration is active.
		 */
		current(): string | null {
			const operations = [
				...set.mock.calls.map(([property, value], index) => ({
					index,
					property,
					kind: 'set' as const,
					value: value as string | null,
				})),
				...remove.mock.calls.map(([property], index) => ({
					index,
					property,
					kind: 'remove' as const,
					value: null,
				})),
			]
				.filter((entry) => entry.property === 'zoom')
				.sort((left, right) => left.index - right.index);
			const last = operations[operations.length - 1];
			if (last === undefined || last.kind === 'remove') return null;
			return last.value;
		},
	};
}

describe('applyScale', () => {
	it('writes the scale as a root declaration', () => {
		const root = recordingRoot();
		applyScale(1.25, root.element);
		expect(root.set).toHaveBeenCalledWith('zoom', '1.25');
		expect(root.current()).toBe('1.25');
	});

	it('removes the declaration at 100% so the layout is untouched', () => {
		const root = recordingRoot();
		applyScale(1.5, root.element);
		applyScale(1, root.element);
		expect(root.remove).toHaveBeenCalledWith('zoom');
		expect(root.current()).toBeNull();
	});

	it('clamps a value outside the ladder', () => {
		const above = recordingRoot();
		applyScale(99, above.element);
		expect(above.current()).toBe('2');

		const below = recordingRoot();
		applyScale(0.01, below.element);
		expect(below.current()).toBe('0.5');
	});

	it('treats a fractional rung as itself', () => {
		const root = recordingRoot();
		applyScale(1.25, root.element);
		expect(root.current()).toBe('1.25');
	});
});

describe('setOverflowLock', () => {
	beforeEach(() => {
		document.getElementById(LOCK_ID)?.remove();
	});

	it('installs exactly one lock while a scale is active', () => {
		setOverflowLock(true, document);
		setOverflowLock(true, document);
		expect(document.querySelectorAll('style').length).toBe(1);
		const lock = document.getElementById(LOCK_ID);
		expect(lock?.textContent).toBe('html{overflow:hidden}');
		expect(lock?.dataset.plugin).toBe('dsh-plugin-ui-zoom');
	});

	it('removes the lock when the scale returns to default', () => {
		setOverflowLock(true, document);
		setOverflowLock(false, document);
		expect(document.getElementById(LOCK_ID)).toBeNull();
	});

	it('tolerates removing a lock that is not installed', () => {
		expect(() => setOverflowLock(false, document)).not.toThrow();
	});
});

describe('clearScale', () => {
	beforeEach(() => {
		document.getElementById(LOCK_ID)?.remove();
	});

	it('undoes every document write', () => {
		const root = recordingRoot();
		applyScale(1.5, root.element);
		setOverflowLock(true, document);
		clearScale(root.element, document);
		expect(root.remove).toHaveBeenCalledWith('zoom');
		expect(document.getElementById(LOCK_ID)).toBeNull();
	});

	it('is idempotent', () => {
		const root = recordingRoot();
		clearScale(root.element, document);
		expect(() => clearScale(root.element, document)).not.toThrow();
	});
});

describe('createReadout', () => {
	/** The single readout element, or null. */
	function hud(): HTMLElement | null {
		return document.querySelector('.dsh-plugin-ui-zoom-hud');
	}

	let readout: Readout | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
		// Keep tests order-independent, including after a failed assertion.
		for (const element of document.querySelectorAll('.dsh-plugin-ui-zoom-hud')) element.remove();
		for (const style of document.querySelectorAll('style[data-plugin="dsh-plugin-ui-zoom"]')) {
			style.remove();
		}
	});

	afterEach(() => {
		readout?.dispose();
		readout = null;
		vi.useRealTimers();
	});

	it('creates its element on first use and reuses it afterwards', () => {
		readout = createReadout(document);
		readout.show(110);
		readout.show(125);
		expect(document.querySelectorAll('.dsh-plugin-ui-zoom-hud').length).toBe(1);
		expect(hud()?.textContent).toBe('125%');
		expect(hud()?.dataset.visible).toBe('true');
	});

	it('adds exactly one stylesheet and removes it on dispose', () => {
		readout = createReadout(document);
		expect(document.querySelectorAll('style[data-plugin="dsh-plugin-ui-zoom"]').length).toBe(1);
		readout.dispose();
		readout = null;
		expect(document.querySelectorAll('style[data-plugin="dsh-plugin-ui-zoom"]').length).toBe(0);
	});

	it('hides itself after the timeout', () => {
		readout = createReadout(document, 500);
		readout.show(80);
		vi.advanceTimersByTime(499);
		expect(hud()?.dataset.visible).toBe('true');
		vi.advanceTimersByTime(1);
		expect(hud()?.dataset.visible).toBe('false');
	});

	it('keeps showing the newest value until its own deadline', () => {
		readout = createReadout(document, 500);
		readout.show(90);
		vi.advanceTimersByTime(400);
		readout.show(110);
		expect(hud()?.textContent).toBe('110%');
		vi.advanceTimersByTime(100);
		// 500ms after the second gesture: still visible.
		expect(hud()?.dataset.visible).toBe('true');
		vi.advanceTimersByTime(400);
		expect(hud()?.dataset.visible).toBe('false');
	});

	it('removes its element on dispose', () => {
		readout = createReadout(document);
		readout.show(150);
		readout.dispose();
		readout = null;
		expect(hud()).toBeNull();
	});

	it('cancels a pending hide on dispose', () => {
		readout = createReadout(document, 500);
		readout.show(150);
		readout.dispose();
		readout = null;
		expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
	});
});
