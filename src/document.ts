/**
 * The only module that touches the document.
 *
 * Applying a scale is a single inline `zoom` declaration on the root element,
 * because the modern `zoom` property scales the used value of `width`, `height`
 * and `font-size` — so nested percentage layouts reflow and the shell still
 * covers the viewport at every rung. A stylesheet rule would be equally correct
 * but couples the effect to a stylesheet having loaded, which is exactly the
 * failure this plugin must not have.
 */

import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE } from './scale.js';

/** Root declaration id owning the overflow lock. */
const OVERFLOW_STYLE_ID = 'dsh-plugin-ui-zoom/overflow';

/**
 * While a scale is active the zoomed coordinate space leaves the document
 * scrollable in its own units; clipping it removes a stray scrollbar without
 * affecting the shell's internal scroll containers.
 */
const OVERFLOW_CSS = 'html{overflow:hidden}';

/**
 * Apply a scale to the document.
 * @param scale - the accepted scale.
 * @param root - the root element to scale.
 */
export function applyScale(scale: number, root: HTMLElement): void {
	const held = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
	// `setProperty` rather than `style.zoom = …`: the two are equivalent in a
	// browser, but only the property API round-trips under every DOM
	// implementation (and it pairs with the `removeProperty` below).
	if (held === DEFAULT_SCALE) root.style.removeProperty('zoom');
	else root.style.setProperty('zoom', String(held));
}
/**
 * Undo everything this plugin wrote to the document.
 * @param root - the root element to restore.
 * @param doc - the document owning the overflow lock.
 */
export function clearScale(root: HTMLElement, doc: Document): void {
	root.style.removeProperty('zoom');
	doc.getElementById(OVERFLOW_STYLE_ID)?.remove();
}

/**
 * Install or remove the overflow lock.
 * @param active - whether a non-default scale is applied.
 * @param doc - the document to lock.
 */
export function setOverflowLock(active: boolean, doc: Document): void {
	const existing = doc.getElementById(OVERFLOW_STYLE_ID);
	if (!active) {
		existing?.remove();
		return;
	}
	if (existing !== null) return;
	const style = doc.createElement('style');
	style.id = OVERFLOW_STYLE_ID;
	style.dataset.plugin = 'dsh-plugin-ui-zoom';
	style.textContent = OVERFLOW_CSS;
	doc.head.append(style);
}

/** Stylesheet for the transient readout that reports an accepted change. */
const HUD_CSS = [
	'.dsh-plugin-ui-zoom-hud{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);',
	'z-index:2147483000;padding:6px 14px;border-radius:999px;pointer-events:none;user-select:none;',
	'font:500 13px/20px var(--dsw-font-family,system-ui,sans-serif);font-variant-numeric:tabular-nums;',
	'color:var(--dsw-alias-label-primary,#e8e8e8);',
	'background:var(--dsw-alias-bg-module-platform,rgba(40,40,44,.92));',
	'border:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));',
	'box-shadow:0 6px 24px rgba(0,0,0,.28);opacity:0;transition:opacity .14s ease}',
	'.dsh-plugin-ui-zoom-hud[data-visible=true]{opacity:1}',
].join('');

/** The transient scale readout. */
export interface Readout {
	/** @param percent - the percentage to display. */
	show(percent: number): void;
	/** Remove the readout and cancel its pending hide. */
	dispose(): void;
}

/**
 * Create the transient readout shown when the user changes the scale.
 *
 * It exists so a key press has visible feedback without permanently occupying
 * screen space: the element fades in, then hides itself.
 * @param doc - the document to mount into.
 * @param timeoutMs - how long the readout stays visible.
 * @returns the readout handle.
 */
export function createReadout(doc: Document, timeoutMs = 900): Readout {
	const style = doc.createElement('style');
	style.dataset.plugin = 'dsh-plugin-ui-zoom';
	style.dataset.pluginCss = 'dsh-plugin-ui-zoom/hud';
	style.textContent = HUD_CSS;
	doc.head.append(style);

	let element: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	return {
		show(percent) {
			const body = doc.body;
			if (body === null) return;
			if (element === null || !element.isConnected) {
				element = doc.createElement('div');
				element.className = 'dsh-plugin-ui-zoom-hud';
				body.append(element);
			}
			element.textContent = `${percent}%`;
			element.dataset.visible = 'true';
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				if (element !== null) element.dataset.visible = 'false';
			}, timeoutMs);
		},
		dispose() {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			element?.remove();
			element = null;
			style.remove();
		},
	};
}
