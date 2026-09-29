import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyScale,
	clearScale,
	createReadout,
	findRoot,
	setOverflowLock,
	type Readout,
} from '../../src/document.js';

/** The id the overflow lock is stored under. */
const LOCK_ID = 'dsh-plugin-ui-zoom/overflow';

/**
 * An element stand-in whose inline style is fully observable.
 *
 * jsdom's `CSSStyleDeclaration` has no `transform` in its property database, so
 * neither `style.transform = …` nor `getPropertyValue('transform')` round-trips
 * there. The plugin's contract is about *which CSS property API it calls*, so
 * that is what these tests assert, via a recording style object. Real rendering
 * is exercised in a real engine by `tests/system/`.
 * @returns the element stand-in and its recorder.
 */
function recordingElement() {
	const operations: { at: number; property: string; value: string | null }[] = [];
	let clock = 0;
	const record = (property: string, value: string | null) => {
		operations.push({ at: clock++, property, value });
	};
	const style = {
		setProperty: (property: string, value: string) => {
			record(property, value);
		},
		removeProperty: (property: string) => {
			record(property, null);
		},
	};
	return {
		element: { style } as unknown as HTMLElement,
		/**
		 * The value currently declared for one property.
		 * @param property - the CSS property name.
		 * @returns the value, or null when no declaration is active.
		 */
		declared(property: string): string | null {
			const relevant = operations
				.filter((entry) => entry.property === property)
				.sort((left, right) => left.at - right.at);
			const last = relevant[relevant.length - 1];
			return last === undefined ? null : last.value;
		},
		/** Every property touched, in order. */
		touched(): string[] {
			return operations.map((entry) => entry.property);
		},
	};
}

describe('applyScale', () => {
	it('scales with a transform and compensates the layout size', () => {
		const root = recordingElement();
		applyScale(1.25, root.element);
		expect(root.declared('transform')).toBe('scale(1.25)');
		expect(root.declared('transform-origin')).toBe('0 0');
		expect(root.declared('width')).toBe('calc(100% / 1.25)');
		expect(root.declared('height')).toBe('calc(100% / 1.25)');
	});

	it('does not declare a zoom property', () => {
		// `zoom` is the mechanism this module deliberately avoids: it lands inside
		// getBoundingClientRect(), which makes an anchored floating layer drift.
		const root = recordingElement();
		applyScale(1.25, root.element);
		expect(root.touched()).not.toContain('zoom');
	});

	it('removes every declaration at 100% so the layout is untouched', () => {
		const root = recordingElement();
		applyScale(1.5, root.element);
		applyScale(1, root.element);
		expect(root.declared('transform')).toBeNull();
		expect(root.declared('transform-origin')).toBeNull();
		expect(root.declared('width')).toBeNull();
		expect(root.declared('height')).toBeNull();
	});

	it('clamps a value outside the ladder', () => {
		const above = recordingElement();
		applyScale(99, above.element);
		expect(above.declared('transform')).toBe('scale(2)');

		const below = recordingElement();
		applyScale(0.01, below.element);
		expect(below.declared('transform')).toBe('scale(0.5)');
	});

	it('keeps fractional rungs exact', () => {
		const root = recordingElement();
		applyScale(1.25, root.element);
		expect(root.declared('width')).toBe('calc(100% / 1.25)');
	});
});

describe('findRoot', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('prefers the application root', () => {
		document.body.innerHTML = '<div id="root"></div>';
		expect(findRoot(document)?.id).toBe('root');
	});

	it('falls back to the body when no application root exists', () => {
		expect(findRoot(document)).toBe(document.body);
	});

	it('accepts the data attribute as an alternative root marker', () => {
		document.body.innerHTML = '<div data-dsh-app-root></div>';
		const found = findRoot(document);
		expect(found?.hasAttribute('data-dsh-app-root')).toBe(true);
	});

	it('returns undefined when nothing matches', () => {
		const empty = { querySelector: () => null } as unknown as Document;
		expect(findRoot(empty)).toBeUndefined();
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
		setOverflowLock(true, document);
		clearScale(document);
		expect(document.getElementById(LOCK_ID)).toBeNull();
	});

	it('is idempotent, including when no root exists', () => {
		const empty = { querySelector: () => null, getElementById: () => null } as unknown as Document;
		expect(() => clearScale(empty)).not.toThrow();
		clearScale(document);
		expect(() => clearScale(document)).not.toThrow();
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

	it('mounts the readout on the body, outside the scaled root', () => {
		readout = createReadout(document);
		readout.show(110);
		expect(hud()?.parentElement).toBe(document.body);
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
