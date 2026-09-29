import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController, type Controller } from '../../src/client.js';
import type { Context, ShortcutCommand } from '../../src/types.js';
import { DEFAULT_SCALE, STORAGE_KEY, parseStored } from '../../src/scale.js';
import type { Readout } from '../../src/document.js';

/**
 * A store standing in for `window.localStorage`.
 * @param initial - seed value for the scale key, when present.
 * @returns the storage plus its raw value map.
 */
function memoryStorage(initial?: string) {
	const values = new Map<string, string>();
	if (initial !== undefined) values.set(STORAGE_KEY, initial);
	return {
		values,
		read: () => parseStored(values.get(STORAGE_KEY) ?? null),
		write(value: number) {
			values.set(STORAGE_KEY, String(value));
		},
	};
}

/**
 * A recording stand-in for the transient readout.
 * @returns the readout and the percentages it was asked to show.
 */
function fakeReadout() {
	const shown: number[] = [];
	const readout: Readout = {
		show: (percent) => {
			shown.push(percent);
		},
		dispose: () => {},
	};
	return { readout, shown };
}

/** A recording stand-in for the plugin context. */
function fakeContext(options: { registerThrows?: boolean } = {}) {
	const registered: ShortcutCommand[] = [];
	const labels: string[] = [];
	const disposers: (() => void)[] = [];
	const ctx = {
		shortcuts: {
			register(command: ShortcutCommand) {
				if (options.registerThrows === true) throw new Error('reserved binding');
				registered.push(command);
				return () => {};
			},
		},
		locale: {
			register: () => () => {},
			bind: () => (key: string) => key,
		},
		effect(callback: () => void | (() => void), label?: string) {
			labels.push(label ?? '(unlabelled)');
			const dispose = callback();
			if (typeof dispose === 'function') disposers.push(dispose);
		},
		get: () => undefined,
	} as unknown as Context;
	return { ctx, registered, labels, disposers };
}

/**
 * A window stand-in with its own listener table.
 *
 * Each install gets a fresh one. That isolation matters: the controller's
 * dedupe guard is deliberately time-based, and fake timers do not advance
 * between tests, so sharing the real jsdom window would let one test's press
 * suppress the next test's.
 * @returns the window facade and a dispatcher for it.
 */
function fakeWindow() {
	const listeners = new Set<(event: KeyboardEvent) => void>();
	const win = {
		navigator: { platform: 'Win32', userAgent: 'test' },
		addEventListener(type: string, listener: (event: KeyboardEvent) => void) {
			if (type === 'keydown') listeners.add(listener);
		},
		removeEventListener(type: string, listener: (event: KeyboardEvent) => void) {
			if (type === 'keydown') listeners.delete(listener);
		},
	} as unknown as Window;
	return {
		win,
		/**
		 * Dispatch a key press to this window.
		 * @param code - physical key code.
		 * @param mods - modifier flags to set.
		 * @param cancelled - whether the event arrives already handled.
		 * @returns the event.
		 */
		dispatch(code: string, mods: Record<string, boolean> = {}, cancelled = false) {
			const event = new KeyboardEvent('keydown', {
				code,
				bubbles: true,
				cancelable: true,
				...mods,
			});
			if (cancelled) event.preventDefault();
			for (const listener of [...listeners]) listener(event);
			return event;
		},
		count: () => listeners.size,
	};
}

/**
 * Install a controller over a recording root element.
 * @param options - fake-context behaviour and seed storage.
 * @returns the controller and its spies.
 */
function install(options: { registerThrows?: boolean; stored?: string } = {}) {
	const fake = fakeContext(options);
	const storage = memoryStorage(options.stored);
	const readout = fakeReadout();
	const harness = fakeWindow();

	const setProperty = vi.fn();
	const removeProperty = vi.fn();
	/**
	 * Order every style operation by a single shared clock.
	 *
	 * Two separate mocks cannot be ordered by their own call indices — both start
	 * at 0 — so the chronological order has to come from a counter they share.
	 */
	let clock = 0;
	const operations: { at: number; property: string; value: string | null }[] = [];
	const root = {
		style: {
			setProperty: (property: string, value: string) => {
				operations.push({ at: clock++, property, value });
				setProperty(property, value);
			},
			removeProperty: (property: string) => {
				operations.push({ at: clock++, property, value: null });
				removeProperty(property);
			},
		},
	} as unknown as HTMLElement;

	// Only the document members the controller actually touches. The overflow lock
	// and the readout are asserted directly in tests/unit/document.test.ts.
	const doc = {
		documentElement: root,
		getElementById: () => null,
		createElement: () => ({ style: {}, dataset: {} }),
		head: { append: () => {} },
	} as unknown as Document;

	const controller = createController({
		ctx: fake.ctx,
		doc,
		win: harness.win,
		storage,
		t: (key) => key,
		readout: () => readout.readout,
	});
	/**
	 * The scale currently declared on the root.
	 * @returns the value, or null when no declaration is active.
	 */
	const declared = () => {
		const relevant = operations
			.filter((entry) => entry.property === 'zoom')
			.sort((left, right) => left.at - right.at);
		const last = relevant[relevant.length - 1];
		return last === undefined ? null : last.value;
	};
	/** Dispatch a press on this install's own window. */
	const dispatch = (code: string, mods: Record<string, boolean> = {}) => harness.dispatch(code, mods);
	current = dispatch;
	return {
		...fake,
		controller,
		storage,
		shown: readout.shown,
		declared,
		press: dispatch,
		dispatch: harness.dispatch,
		listeners: harness.count,
	};
}

/**
 * Dispatcher of the most recent install.
 *
 * Module-level tests call this so their bodies stay readable; each install
 * replaces it, which also keeps presses inside that install's own window.
 */
let current: ((code: string, mods?: Record<string, boolean>) => KeyboardEvent) | null = null;

/**
 * Dispatch one key press to the active install.
 * @param code - physical key code.
 * @param mods - modifier flags to set.
 * @returns the dispatched event.
 */
function press(code: string, mods: Record<string, boolean> = {}): KeyboardEvent {
	if (current === null) throw new Error('no controller installed');
	return current(code, mods);
}

describe('the zoom controller', () => {
	let active: Controller | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		active?.dispose();
		active = null;
		vi.useRealTimers();
	});

	it('starts at 100% and declares no zoom', () => {
		const { controller, declared } = install();
		active = controller;
		expect(controller.scale()).toBe(1);
		expect(declared()).toBeNull();
	});

	it('restores a stored scale on install without announcing it', () => {
		const { controller, declared, shown } = install({ stored: '1.25' });
		active = controller;
		expect(controller.scale()).toBe(1.25);
		expect(declared()).toBe('1.25');
		expect(shown).toEqual([]);
	});

	it('ignores an unusable stored scale', () => {
		const { controller, declared } = install({ stored: 'enormous' });
		active = controller;
		expect(controller.scale()).toBe(DEFAULT_SCALE);
		expect(declared()).toBeNull();
	});

	it('zooms in on Ctrl+=', () => {
		const { controller, declared, shown } = install();
		active = controller;
		press('Equal', { ctrlKey: true });
		expect(controller.scale()).toBe(1.1);
		expect(declared()).toBe('1.1');
		expect(shown).toEqual([110]);
	});

	it('zooms out on Ctrl+-', () => {
		const { controller } = install({ stored: '1.25' });
		active = controller;
		press('Minus', { ctrlKey: true });
		expect(controller.scale()).toBe(1.1);
	});

	it('accepts the shifted plus spelling', () => {
		const { controller } = install();
		active = controller;
		press('Equal', { ctrlKey: true, shiftKey: true });
		expect(controller.scale()).toBe(1.1);
	});

	it('accepts the numeric pad, which the registry cannot bind', () => {
		const { controller } = install();
		active = controller;
		press('NumpadAdd', { ctrlKey: true });
		expect(controller.scale()).toBe(1.1);
		vi.advanceTimersByTime(100);
		press('NumpadSubtract', { ctrlKey: true });
		expect(controller.scale()).toBe(1);
		vi.advanceTimersByTime(100);
		press('Numpad0', { ctrlKey: true });
		expect(controller.scale()).toBe(1);
	});

	it('resets to 100% and removes the declaration', () => {
		const { controller, declared } = install({ stored: '1.75' });
		active = controller;
		press('Digit0', { ctrlKey: true });
		expect(controller.scale()).toBe(1);
		expect(declared()).toBeNull();
	});

	it('walks the whole ladder and clamps at both ends', () => {
		const { controller } = install();
		active = controller;
		press('Equal', { ctrlKey: true });
		expect(controller.scale()).toBe(1.1);
		vi.advanceTimersByTime(100);
		press('Minus', { ctrlKey: true });
		expect(controller.scale()).toBe(1);

		// One press per dedupe window, all the way up and then past the ceiling.
		for (let index = 0; index < 20; index++) {
			vi.advanceTimersByTime(100);
			press('Equal', { ctrlKey: true });
		}
		expect(controller.scale()).toBe(2);

		for (let index = 0; index < 20; index++) {
			vi.advanceTimersByTime(100);
			press('Minus', { ctrlKey: true });
		}
		expect(controller.scale()).toBe(0.5);
	});

	it('reports the readout even at a clamped end', () => {
		const { controller, shown } = install({ stored: '2' });
		active = controller;
		press('Equal', { ctrlKey: true });
		expect(controller.scale()).toBe(2);
		expect(shown).toEqual([200]);
	});

	it('ignores presses without the primary modifier', () => {
		const { controller } = install();
		active = controller;
		press('Equal');
		press('Minus');
		press('Digit0');
		press('Equal', { shiftKey: true });
		expect(controller.scale()).toBe(1);
	});

	it('ignores unrelated commands', () => {
		const { controller } = install();
		active = controller;
		press('KeyA', { ctrlKey: true });
		press('KeyC', { ctrlKey: true });
		press('Slash', { ctrlKey: true });
		expect(controller.scale()).toBe(1);
	});

	it('leaves Alt combinations to the shell', () => {
		const { controller } = install();
		active = controller;
		press('Minus', { ctrlKey: true, altKey: true });
		expect(controller.scale()).toBe(1);
	});

	it('cancels the event it consumes so the shell does not also act', () => {
		const { controller } = install();
		active = controller;
		expect(press('Equal', { ctrlKey: true }).defaultPrevented).toBe(true);
	});

	it('does not cancel an event it ignores', () => {
		const { controller } = install();
		active = controller;
		expect(press('KeyA', { ctrlKey: true }).defaultPrevented).toBe(false);
	});

	it('does not consume an already-cancelled event', () => {
		const { controller, dispatch } = install();
		active = controller;
		dispatch('Equal', { ctrlKey: true }, true);
		expect(controller.scale()).toBe(1);
	});

	it('treats one physical press seen on both input paths as a single step', () => {
		const { controller, registered } = install();
		active = controller;
		// Electron forwards a registry-matched binding to the page, so the registry
		// dispatches first and the DOM listener then sees the same physical press.
		const command = registered.find((entry) => entry.id === 'view.zoomIn');
		expect(command).toBeDefined();
		const resolution = command?.resolve();
		expect(resolution?.status).toBe('handled');
		if (resolution?.status === 'handled') resolution.run();
		press('Equal', { ctrlKey: true });
		expect(controller.scale()).toBe(1.1);
	});

	it('applies a fresh press after the dedupe window', () => {
		const { controller } = install();
		active = controller;
		press('Equal', { ctrlKey: true });
		vi.advanceTimersByTime(100);
		press('Equal', { ctrlKey: true });
		expect(controller.scale()).toBe(1.25);
	});

	it('persists every accepted change', () => {
		const { controller, storage } = install();
		active = controller;
		press('Equal', { ctrlKey: true });
		expect(storage.values.get(STORAGE_KEY)).toBe('1.1');
		vi.advanceTimersByTime(100);
		press('Digit0', { ctrlKey: true });
		expect(storage.values.get(STORAGE_KEY)).toBe('1');
	});

	it('offers all three commands to the shortcut registry', () => {
		const { registered } = install();
		expect(registered.map((entry) => entry.id)).toEqual([
			'view.zoomIn',
			'view.zoomOut',
			'view.zoomReset',
		]);
	});

	it('declares page, editable, and terminal regions for every command', () => {
		const { registered } = install();
		for (const command of registered) {
			expect(command.regions).toEqual(['page', 'editable', 'terminal']);
			expect(command.modals).toEqual([]);
		}
	});

	it('binds the registry commands to the conventional keys', () => {
		const { registered } = install();
		const byId = new Map(registered.map((entry) => [entry.id, entry]));
		expect(byId.get('view.zoomIn')?.defaults['desktop:windows']).toEqual({
			code: 'Equal',
			modifiers: ['primary'],
		});
		expect(byId.get('view.zoomOut')?.defaults['desktop:macos']).toEqual({
			code: 'Minus',
			modifiers: ['primary'],
		});
		expect(byId.get('view.zoomReset')?.defaults['web:linux']).toEqual({
			code: 'Digit0',
			modifiers: ['primary'],
		});
	});

	it('offers every platform profile the registry may ask about', () => {
		const { registered } = install();
		for (const command of registered) {
			expect(Object.keys(command.defaults).sort()).toEqual([
				'desktop:linux',
				'desktop:macos',
				'desktop:windows',
				'web:linux',
				'web:macos',
				'web:windows',
			]);
		}
	});

	it('registers a live locale binding', () => {
		const { registered } = install();
		expect(registered[0]?.label()).toBe('zoom.in');
	});

	it('keeps working when the registry rejects a binding', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { controller, registered } = install({ registerThrows: true });
		active = controller;
		// Every command is attempted separately so one rejection cannot suppress
		// the others; all three fail here and all three are reported.
		expect(registered).toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(3);
		// The DOM path is independent of the registry, so the gesture still works.
		press('Equal', { ctrlKey: true });
		console.log('DEBUG warn=', warn.mock.calls.length, 'scale=', controller.scale());
		expect(controller.scale()).toBe(1.1);
		warn.mockRestore();
	});

	it('attempts every command even when an earlier one is rejected', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const commands: string[] = [];
		const fake = fakeContext();
		fake.ctx.shortcuts.register = (command: ShortcutCommand) => {
			commands.push(command.id);
			// Only the first command collides.
			if (command.id === 'view.zoomIn') throw new Error('conflicting shortcut defaults');
			return () => {};
		};
		const storage = memoryStorage();
		const root = { style: { setProperty: () => {}, removeProperty: () => {} } } as unknown as HTMLElement;
		const doc = {
			documentElement: root,
			getElementById: () => null,
			createElement: () => ({ style: {}, dataset: {} }),
			head: { append: () => {} },
		} as unknown as Document;
		const controller = createController({
			ctx: fake.ctx,
			doc,
			win: window,
			storage,
			t: (key) => key,
			readout: () => fakeReadout().readout,
		});
		active = controller;
		expect(commands).toEqual(['view.zoomIn', 'view.zoomOut', 'view.zoomReset']);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('stops reacting once disposed', () => {
		const { controller } = install({ stored: '1.5' });
		active = controller;
		controller.dispose();
		active = null;
		press('Equal', { ctrlKey: true });
		expect(controller.scale()).toBe(1.5);
	});

	it('registers a teardown effect that clears the declaration', () => {
		const { controller, declared, disposers } = install({ stored: '1.5' });
		active = controller;
		expect(declared()).toBe('1.5');
		for (const dispose of disposers) dispose();
		expect(declared()).toBeNull();
	});
});
