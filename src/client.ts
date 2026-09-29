/**
 * Browser half: the zoom controller and the Cordis plugin it installs.
 *
 * Two input paths are active at once, deliberately:
 *
 * 1. The application shortcut registry (`ctx.shortcuts.register`) — this is what
 *    makes the gestures discoverable and rebindable in Settings, and it is the
 *    path that matches how the rest of the product wires commands.
 * 2. A capture-phase `keydown` listener — this carries the gestures the registry
 *    cannot express: numeric-pad codes (its validator accepts only `KeyA–Z`,
 *    `Digit0–9` and function keys) and the `Ctrl+Shift+=` spelling of `+`.
 *
 * Because Electron forwards a registry-matched binding to the page as ordinary
 * input, one physical press can surface on both paths; a short guard window
 * keeps that press to a single step.
 */

import {
	createReadout,
	applyScale,
	clearScale,
	setOverflowLock,
	type Readout,
} from './document.js';
import { classify, type KeyDescriptor } from './gestures.js';
import {
	DEFAULT_SCALE,
	createStorage,
	scalePercent,
	stepScale,
	type ScaleStorage,
	type Step,
} from './scale.js';
import type { Context, LocaleDict, ShortcutBinding, ShortcutCommand } from './types.js';
import { describe, trace } from './trace.js';

// Module scope runs before the plugin mounts, so this entry answers the first
// question a failure raises: did the bundle execute at all?
trace('M:module');

/** Locale namespace owned by this plugin. */
export const LOCALE_NS = 'ui-zoom';

/** English labels. */
export const EN: LocaleDict = {
	'zoom.in': 'Zoom in',
	'zoom.out': 'Zoom out',
	'zoom.reset': 'Reset zoom to 100%',
};

/** Chinese labels. */
export const ZH: LocaleDict = {
	'zoom.in': '放大界面',
	'zoom.out': '缩小界面',
	'zoom.reset': '恢复界面缩放至 100%',
};

/**
 * One physical press can arrive on both input paths; only the first arrival
 * inside this window may move the scale.
 */
const DEDUPE_WINDOW_MS = 60;

/** Everything the controller reads from its host environment. */
export interface ControllerOptions {
	/** The plugin context. */
	readonly ctx: Context;
	/** The document to scale. */
	readonly doc: Document;
	/** The window owning the keyboard listener. */
	readonly win: Window;
	/** Scale persistence. */
	readonly storage: ScaleStorage;
	/** Localized label lookup. */
	readonly t: (key: string) => string;
	/** Transient readout factory; injectable so tests avoid real timers. */
	readonly readout?: (doc: Document) => Readout;
}

/** The installed controller. */
export interface Controller {
	/** Current accepted scale. */
	readonly scale: () => number;
	/** Detach every listener and undo every document write. */
	readonly dispose: () => void;
}

/**
 * Whether the visiting platform is macOS.
 *
 * `navigator.platform` is deprecated but remains the value the shortcut
 * registry itself reads for this decision, so matching it keeps the two
 * modifier resolutions identical.
 * @param nav - the navigator to inspect.
 * @returns whether the platform reads as macOS.
 */
function isMacPlatform(nav: Navigator): boolean {
	const probe = `${nav.platform ?? ''}${nav.userAgent ?? ''}`;
	return /mac|iphone|ipad/i.test(probe);
}

/**
 * The default binding for one platform profile.
 * @param code - the physical key code.
 * @returns the binding, with `primary` left for the registry to resolve.
 */
function defaultBinding(code: string): ShortcutBinding {
	return { code, modifiers: ['primary'] };
}

/**
 * Every platform profile maps the same physical key; `primary` differs per
 * platform, which is exactly the intent.
 * @param code - the physical key code.
 * @returns the per-profile defaults.
 */
function defaultsFor(code: string): Record<string, ShortcutBinding> {
	const profiles = [
		'desktop:macos',
		'desktop:windows',
		'desktop:linux',
		'web:macos',
		'web:windows',
		'web:linux',
	];
	return Object.fromEntries(profiles.map((profile) => [profile, defaultBinding(code)]));
}

/**
 * Build one registry command.
 * @param id - dotted action identity.
 * @param code - physical key code.
 * @param label - the already-localized label.
 * @param run - the action.
 * @returns the command definition.
 */
function command(id: string, code: string, label: string, run: () => void): ShortcutCommand {
	return {
		id,
		label: () => label,
		defaults: defaultsFor(code),
		// The terminal and the composer are both ordinary focus targets for a
		// document-wide view preference.
		regions: ['page', 'editable', 'terminal'],
		modals: [],
		resolve: () => ({ status: 'handled', run }),
	};
}

/**
 * Install the zoom gestures and return the controller.
 * @param options - the host environment.
 * @returns the installed controller.
 */
export function createController(options: ControllerOptions): Controller {
	const { ctx, doc, win, storage, t } = options;
	const root = doc.documentElement;
	const nav = win.navigator;
	const mac = isMacPlatform(nav);
	const readout = (options.readout ?? createReadout)(doc);

	let scale = 1;
	let handledAt = 0;

	/**
	 * Claim the current press for this plugin.
	 * @returns whether this caller may act.
	 */
	const claim = (): boolean => {
		const now = Date.now();
		if (now - handledAt < DEDUPE_WINDOW_MS) return false;
		handledAt = now;
		return true;
	};

	/**
	 * Publish a scale to the document and to storage.
	 * @param next - the scale to apply.
	 * @param announce - whether to show the readout.
	 */
	const publish = (next: number, announce: boolean): void => {
		scale = next;
		applyScale(scale, root);
		setOverflowLock(scale !== DEFAULT_SCALE, doc);
		storage.write(scale);
		if (announce) readout.show(scalePercent(scale));
	};

	/**
	 * Move one rung.
	 * @param step - the direction.
	 * @param announce - whether to show the readout.
	 */
	const step = (step: Step, announce: boolean): void => {
		const next = stepScale(scale, step);
		if (next === scale) {
			// Still report at the clamped ends so the press is never silent.
			if (announce) readout.show(scalePercent(scale));
			return;
		}
		publish(next, announce);
	};

	/**
	 * Handle one classified press.
	 * @param event - the key descriptor to read.
	 * @param consume - the event to cancel, when the DOM path owns it.
	 * @param fromRegistry - whether the registry already dispatched this press.
	 */
	const handle = (event: KeyDescriptor, consume: Event | null, fromRegistry: boolean): void => {
		const action = classify(event, mac);
		if (action === null) return;
		if (fromRegistry) handledAt = Date.now();
		else if (!claim()) return;
		if (consume !== null) {
			consume.preventDefault();
			consume.stopPropagation();
		}
		if (action.kind === 'reset') publish(DEFAULT_SCALE, true);
		else step(action.step, true);
	};

	const onKeydown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented) return;
		handle(
			{
				code: event.code,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				shiftKey: event.shiftKey,
			},
			event,
			false,
		);
	};

	// Restore the stored preference before the user's first gesture.
	const restored = storage.read() ?? DEFAULT_SCALE;
	publish(restored, false);
	trace(`C:restored=${String(restored)}`);

	// Self-check: prove the inline declaration actually reaches the document and
	// is readable back, then restore. A platform where `zoom` is accepted but not
	// honoured would otherwise leave the gestures silently inert.
	try {
		root.style.setProperty('zoom', '0.5');
		// Read the string BEFORE restoring: `getPropertyValue` returns a live value,
		// so reading it afterwards would report the restored scale instead.
		const effective = win.getComputedStyle(root).getPropertyValue('zoom').trim();
		applyScale(restored, root);
		trace(`C:selftest=${effective === '' ? '<empty>' : effective}`);
	} catch (error) {
		applyScale(restored, root);
		trace(`C:selftest-failed:${describe(error)}`);
	}

	win.addEventListener('keydown', onKeydown, true);
	trace('C:listening');

	/**
	 * Offer one command to the registry.
	 *
	 * Registration can legitimately fail — a default binding may collide with a
	 * command another plugin registered, or a future Harness may reserve the
	 * combination. Each command is therefore attempted on its own and a failure
	 * is contained: the DOM listener keeps the gesture working, and a shortcut
	 * problem can never fail this plugin's activation (which would take the
	 * whole client boot down with it).
	 * @param definition - the command to register.
	 * @param label - diagnostic name for the effect.
	 */
	const offer = (definition: ShortcutCommand, label: string): void => {
		try {
			ctx.effect(() => ctx.shortcuts.register(definition), label);
		} catch (error) {
			report(definition.id, error);
		}
	};

	ctx.effect(
		() => () => {
			win.removeEventListener('keydown', onKeydown, true);
			readout.dispose();
			clearScale(root, doc);
		},
		`${LOCALE_NS}: state`,
	);

	// The `=`/`-` pair carries the discoverable commands; the numeric pad and the
	// `+` spelling are handled by the DOM listener alone.
	offer(command('view.zoomIn', 'Equal', t('zoom.in'), () => {
		if (claim()) step(1, true);
	}), `ui-zoom: ${t('zoom.in')}`);
	offer(command('view.zoomOut', 'Minus', t('zoom.out'), () => {
		if (claim()) step(-1, true);
	}), `ui-zoom: ${t('zoom.out')}`);
	offer(command('view.zoomReset', 'Digit0', t('zoom.reset'), () => {
		if (claim()) publish(DEFAULT_SCALE, true);
	}), `ui-zoom: ${t('zoom.reset')}`);

	return {
		scale: () => scale,
		dispose: () => {
			win.removeEventListener('keydown', onKeydown, true);
		},
	};
}

/**
 * Report a contained registration failure without a logger dependency.
 * @param id - the command identity that failed.
 * @param error - the thrown value.
 */
function report(id: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	// eslint-disable-next-line no-console -- a contained failure must still be visible.
	console.warn(`[ui-zoom] shortcut "${id}" was not registered: ${message}`);
}

/**
 * Install the plugin on the client context.
 *
 * Every step is failure-contained and traced. The trace exists because an
 * activation failure inside a sandboxed renderer is otherwise invisible: the
 * console it writes to cannot be read from outside, and the Host's crash report
 * covers only application-fatal errors.
 * @param ctx - the plugin context; `shortcuts` and `locale` are injected.
 */
export function apply(ctx: Context): void {
	trace('A:apply');

	try {
		ctx.effect(
			() => ctx.locale.register(LOCALE_NS, { en: EN, zh: ZH }),
			`${LOCALE_NS}: dictionaries`,
		);
	} catch (error) {
		trace(`A:locale-failed:${describe(error)}`);
	}

	let t: (key: string) => string = (key) => key;
	try {
		t = ctx.locale.bind(LOCALE_NS);
	} catch (error) {
		trace(`A:bind-failed:${describe(error)}`);
	}

	const storage = createStorage(
		(key) => window.localStorage.getItem(key),
		(key, value) => {
			window.localStorage.setItem(key, value);
		},
	);

	let controller: Controller | null = null;
	try {
		controller = createController({
			ctx,
			doc: window.document,
			win: window,
			storage,
			t,
		});
	} catch (error) {
		// The scale itself lives in the controller, so a failure here is the one
		// worth naming precisely.
		trace(`A:controller-failed:${describe(error)}`);
		throw error;
	}

	// Arrival witness. This observes the page's own key events independently of
	// the controller, which answers the question a trace cannot: whether the
	// gesture reaches the document at all.
	try {
		window.addEventListener(
			'keydown',
			(event) => {
				const mods = `${event.ctrlKey ? 'c' : ''}${event.metaKey ? 'm' : ''}${event.altKey ? 'a' : ''}${event.shiftKey ? 's' : ''}`;
				trace(`K:${event.code}:${mods}`);
			},
			true,
		);
	} catch (error) {
		trace(`A:witness-failed:${describe(error)}`);
	}

	trace(`A:ready:${String(controller.scale())}`);
}

/** Services this plugin needs before it can activate. */
export const inject = ['shortcuts', 'locale'];
