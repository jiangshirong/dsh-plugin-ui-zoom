/**
 * Gesture recognition.
 *
 * Kept free of the plugin context so the matching table can be unit-tested
 * directly. The client half feeds it real `KeyboardEvent`s; tests feed it
 * synthetic descriptors.
 */

import type { Step } from './scale.js';

/** The action a gesture asks for. */
export type GestureAction =
	| { readonly kind: 'step'; readonly step: Step }
	| { readonly kind: 'reset' };

/**
 * The subset of a keyboard event this module reads. Accepting a descriptor
 * instead of a `KeyboardEvent` keeps the rules testable without a DOM.
 */
export interface KeyDescriptor {
	/** Physical key code. */
	readonly code: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

/**
 * Physical codes for increasing the scale.
 *
 * `Equal` is the `=`/`+` key: with Shift held it produces the `+` glyph, which
 * is why Shift is admitted for this gesture. `NumpadAdd` covers the numeric pad,
 * which the application shortcut registry cannot bind (its code validator
 * accepts only `KeyA–Z`, `Digit0–9` and function keys), so the DOM listener is
 * the only path that can carry it.
 */
export const ZOOM_IN_CODES: readonly string[] = ['Equal', 'NumpadAdd'];

/** Physical codes for decreasing the scale. */
export const ZOOM_OUT_CODES: readonly string[] = ['Minus', 'NumpadSubtract'];

/** Physical codes for returning to 100%. */
export const RESET_CODES: readonly string[] = ['Digit0', 'Numpad0'];

/**
 * Whether the primary modifier for this platform is held.
 *
 * The primary modifier is Control on Windows/Linux and Meta on macOS, matching
 * how the shortcut registry resolves a `primary` declaration.
 * @param event - the key descriptor.
 * @param isMac - whether the visiting platform is macOS.
 * @returns whether the primary modifier is down.
 */
export function hasPrimaryModifier(event: KeyDescriptor, isMac: boolean): boolean {
	return isMac ? event.metaKey : event.ctrlKey;
}

/**
 * Classify one key press.
 *
 * The primary modifier must be held and Alt must not be: Alt combinations are
 * reserved by the shell and would otherwise swallow Alt+minus text input.
 * Shift is admitted solely because it is how the `+` glyph is typed.
 * @param event - the key descriptor.
 * @param isMac - whether the visiting platform is macOS.
 * @returns the requested action, or null when this is not a zoom gesture.
 */
export function classify(event: KeyDescriptor, isMac: boolean): GestureAction | null {
	if (!hasPrimaryModifier(event, isMac) || event.altKey) return null;
	if (ZOOM_IN_CODES.includes(event.code)) return { kind: 'step', step: 1 };
	if (ZOOM_OUT_CODES.includes(event.code)) return { kind: 'step', step: -1 };
	if (RESET_CODES.includes(event.code)) return { kind: 'reset' };
	return null;
}
