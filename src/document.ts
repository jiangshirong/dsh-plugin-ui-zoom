/**
 * The only module that touches the document.
 *
 * Scaling is a `transform` on the application root, not a `zoom` declaration on
 * the document. That choice is forced by one measured fact: `zoom` lands inside
 * `getBoundingClientRect()`, so a floating layer positioned from a measured rect
 * is scaled a second time when `position: fixed` resolves against the zoomed
 * initial containing block. Measured gap below an anchored button, where 8px is
 * correct:
 *
 * | scale | `zoom` on `:root` | `transform` on the shell |
 * |---|---|---|
 * | 100% | 8 | 8 |
 * | 70% | -201 | 8 |
 * | 110% | 77 | 8 |
 * | 125% | 179 | 8 |
 * | 150% | 348 | 8 |
 *
 * A `transform` leaves the used geometry of every element untouched, so a menu
 * anchored to a button keeps landing on the button at every scale.
 *
 * The cost of a transform is that it does not reflow: the shell would keep its
 * unscaled layout size and leave a gap at the right and bottom edges. That is
 * what the inverse sizing compensates — the shell is laid out at `100% / scale`
 * and then scaled by `scale`, so its laid-out box is the bounding box of its
 * rendered box again and its percentage children still divide the real viewport.
 */

import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE } from './scale.js';

/**
 * Candidates for the scaling root, innermost first.
 *
 * A dedicated application root is preferred so the document, and anything the
 * host page mounts beside the application, stay outside the transform.
 */
const ROOT_SELECTORS = ['#root', '[data-dsh-app-root]', 'body'] as const;

/** Root declaration id owning the overflow lock. */
const OVERFLOW_STYLE_ID = 'dsh-plugin-ui-zoom/overflow';

/**
 * Find the element to scale.
 * @param doc - the document to search.
 * @returns the scaling root, or undefined when none of the candidates exist.
 */
export function findRoot(doc: Document): HTMLElement | undefined {
	for (const selector of ROOT_SELECTORS) {
		const element = doc.querySelector(selector);
		if (element instanceof HTMLElement) return element;
	}
	return undefined;
}

/**
 * Apply a scale to the application root.
 *
 * `transform-origin: 0 0` is load-bearing: with the default centre origin the
 * shell would be laid out in one place and painted around the viewport centre,
 * leaving the top-left corner adrift.
 * @param scale - the scale to apply.
 * @param root - the element to scale.
 */
export function applyScale(scale: number, root: HTMLElement): void {
	const held = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
	const { style } = root;
	if (held === DEFAULT_SCALE) {
		style.removeProperty('transform');
		style.removeProperty('transform-origin');
		style.removeProperty('width');
		style.removeProperty('height');
		return;
	}
	style.setProperty('transform-origin', '0 0');
	style.setProperty('transform', `scale(${String(held)})`);
	style.setProperty('width', `calc(100% / ${String(held)})`);
	style.setProperty('height', `calc(100% / ${String(held)})`);
}

/**
 * Undo every write this plugin made to the document.
 * @param doc - the document to restore.
 */
export function clearScale(doc: Document): void {
	const root = findRoot(doc);
	if (root !== undefined) {
		const { style } = root;
		style.removeProperty('transform');
		style.removeProperty('transform-origin');
		style.removeProperty('width');
		style.removeProperty('height');
	}
	doc.getElementById(OVERFLOW_STYLE_ID)?.remove();
}

/**
 * Keep the document itself from growing a stray scrollbar.
 *
 * With the transform approach the shell no longer changes the document's scroll
 * metrics, so this is a guard rather than a requirement: it is removed entirely
 * at 100%, and keeps a fractional scale from producing an edge scrollbar.
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
	style.textContent = 'html{overflow:hidden}';
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
 * It is mounted on `document.body`, outside the scaled root, so its own text is
 * never rescaled.
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
