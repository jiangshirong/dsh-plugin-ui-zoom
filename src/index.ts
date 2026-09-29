/**
 * Interface zoom for the DeepSeek Harness web client — Host half.
 *
 * The browser half owns the zoom. This half exists because a Loader row needs a
 * module to import, and it carries one diagnostic duty: it mirrors the browser
 * half's own journal out of the renderer's local storage into a plain text file.
 *
 * That channel exists because an activation failure inside a sandboxed renderer
 * is otherwise unobservable from outside — its console is unreachable, and the
 * application crash report covers only application-fatal errors. With it,
 * "did the browser half run, and how far did it get" is answerable from disk.
 *
 * @module dsh-plugin-ui-zoom
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TRACE_KEY, readJournalPayloads } from './journal.js';
import type { EffectContext } from './types.js';

/** How often the renderer's storage is polled. */
const POLL_MS = 800;

/**
 * Resolve the renderer's Local Storage leveldb directory.
 * @returns the directory, or undefined when the platform gives no app data root.
 */
function storageRoot(): string | undefined {
	const appData = process.env.APPDATA;
	if (appData === undefined || appData === '') return undefined;
	return join(appData, '@deepseek-ai', 'dsh-desktop', 'Local Storage', 'leveldb');
}

/**
 * Watch the renderer's journal and append new payloads to a text file.
 * @param ctx - the plugin's host context.
 */
function mirrorTrace(ctx: EffectContext): void {
	const root = storageRoot();
	if (root === undefined) return;
	const output = join(process.env.DSH_HOME ?? process.cwd(), 'ui-zoom-trace.log');
	const seen = new Set<string>();

	const scan = (): void => {
		let names: string[];
		try {
			names = existsSync(root) ? readdirSync(root) : [];
		} catch {
			return;
		}
		for (const name of names) {
			if (!name.endsWith('.log') && !name.endsWith('.ldb')) continue;
			let raw: Buffer;
			try {
				raw = readFileSync(join(root, name));
			} catch {
				continue;
			}
			for (const payload of readJournalPayloads(raw, TRACE_KEY)) {
				if (seen.has(payload)) continue;
				seen.add(payload);
				try {
					appendFileSync(output, `${new Date().toISOString()} ${payload}\n`);
				} catch {
					/* diagnostics must never break the plugin */
				}
			}
		}
	};

	ctx.effect(() => {
		const timer = setInterval(scan, POLL_MS);
		scan();
		return () => {
			clearInterval(timer);
		};
	}, 'ui-zoom: trace mirror');
}

/**
 * Host half entry.
 * @param ctx - the plugin's host context.
 */
export function apply(ctx: EffectContext): void {
	mirrorTrace(ctx);
}
