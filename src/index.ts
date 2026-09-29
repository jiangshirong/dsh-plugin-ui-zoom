/**
 * Interface zoom for the DeepSeek Harness web client.
 *
 * A client-half plugin: the package root is an inert Host row (a Cordis entry
 * needs one), and the browser half registered by `exports["./client"]` installs
 * the zoom gestures and scales the document.
 *
 * @module dsh-plugin-ui-zoom
 */
import type { Context } from './types.js';

/** Marker name used in the trace when the plugin is unloaded. */
export const PLUGIN_ID = 'dsh-plugin-ui-zoom';

/**
 * Host half. Intentionally empty: everything this plugin does happens in the
 * browser, but a Loader row must import a module with an `apply` export.
 */
export function apply(_ctx: Context): void {
	/* no host-side behaviour */
}
