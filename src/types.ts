/**
 * The declarations this plugin consumes from the DeepSeek Harness client
 * runtime.
 *
 * Scope: only what ui-zoom touches. The runtime's own types live in the
 * `@deepseek-ai/dsh-client-*` packages; an out-of-tree plugin does not depend on
 * them so that it keeps working across Harness releases, and these local
 * structural declarations describe the small surface that is actually used.
 *
 * Verified against `packages/client/shortcuts/src/client/registry.ts` and
 * `packages/client/locale/src/client/index.ts`.
 */

/** One physical key plus its modifier set. */
export interface ShortcutBinding {
	/** KeyboardEvent.code of the non-modifier key, e.g. `Equal`, `Minus`, `Digit0`. */
	readonly code: string;
	/**
	 * Logical modifiers. `primary` resolves per platform — Control on
	 * Windows/Linux, Meta on macOS.
	 */
	readonly modifiers: readonly ('primary' | 'control' | 'alt' | 'shift' | 'meta')[];
}

/** The input region a gesture originates from. */
export type ShortcutRegion = 'page' | 'editable' | 'terminal';

/** The resolution a command returns when it is asked to run. */
export type ShortcutResolution =
	| { readonly status: 'handled'; readonly run: () => void }
	| { readonly status: 'pass' };

/** One configurable command offered to the application shortcut registry. */
export interface ShortcutCommand {
	/** Dotted action identity, e.g. `view.zoomIn`. */
	readonly id: string;
	/** Localized label; called on every catalog refresh. */
	readonly label: () => string;
	/** Search aliases for the shortcut editor. */
	readonly aliases?: readonly string[];
	/** Default binding per `<runtime>:<platform>` profile. */
	readonly defaults: Readonly<Record<string, ShortcutBinding>>;
	/** Regions this command is allowed to fire in. */
	readonly regions: readonly ShortcutRegion[];
	/** Modal ids this command may fire within; empty means "no modal". */
	readonly modals: readonly string[];
	/** Decide whether this command runs for the current input context. */
	readonly resolve: () => ShortcutResolution;
}

/**
 * The shortcut service face this plugin uses. Services are ordinary properties
 * on the plugin context for every name declared in `dsh.client.inject`.
 */
export interface ShortcutsService {
	/**
	 * Register a configurable command.
	 * @param command - the command definition.
	 * @returns an idempotent disposer.
	 * @throws when the identity is already registered or a default binding is
	 * reserved or conflicting.
	 */
	register(command: ShortcutCommand): () => void;
}

/** One translation dictionary for a locale namespace. */
export type LocaleDict = Record<string, string>;

/** The locale service face this plugin uses. */
export interface LocaleService {
	/**
	 * Register dictionaries for a namespace.
	 * @param ns - namespace key.
	 * @param dicts - dictionaries keyed by built-in locale id.
	 * @returns a disposer removing the namespace.
	 */
	register(ns: string, dicts: Record<string, LocaleDict>): () => void;
	/**
	 * Bind a translation function to a namespace.
	 * @param ns - namespace key.
	 * @returns a translator for that namespace.
	 */
	bind(ns: string): (key: string) => string;
}

/**
 * The plugin context handed to the browser half's `apply`.
 *
 * Only the members this plugin uses are declared; the real object carries the
 * full Cordis surface. `get` is the undeclared-service lookup, which never
 * throws so optional peers can be probed.
 */
export interface Context {
	readonly shortcuts: ShortcutsService;
	readonly locale: LocaleService;
	/**
	 * Run one setup step and register its cleanup with the plugin's lifetime.
	 * @param callback - setup; may return a disposer.
	 * @param label - diagnostic name for the effect.
	 */
	effect(callback: () => void | (() => void), label?: string): void;
	/**
	 * Look up a service that was not declared in `inject`.
	 * @param name - service key.
	 * @returns the service, or undefined when absent.
	 */
	get(name: string): unknown;
}
