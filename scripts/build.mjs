/**
 * Build both halves of the plugin.
 *
 * The Host half is plain ESM: the Loader imports the package root directly, so
 * TypeScript's own output is already the shipping artifact.
 *
 * The browser half must be a bundle that registers a factory with the page's
 * module table and RETURNS the package exports. That envelope is what an
 * out-of-tree plugin cannot get from the in-repo build pipeline, so it is
 * written here explicitly:
 *
 *   window.__ModuleLoader__.load({ id: "<package>", factory: (require) => { ... } })
 *
 * Two details are load-bearing and were both learned the hard way:
 *
 * - The global is `window.__ModuleLoader__`. First-party bundles are compiled
 *   with a local alias (they read `ow.__ModuleLoader__`) because the bundler
 *   declares that alias inside its own output; an out-of-tree bundle has no such
 *   scope, and copying the alias produces `ReferenceError: ow is not defined` at
 *   page boot.
 * - The factory's RETURN value is the module exports. The envelope declares
 *   `module`/`exports`/`require` for source compatibility, but nothing reads
 *   `module.exports`, so a factory that assigns to `exports` and returns nothing
 *   yields `undefined` and fails activation.
 *
 * The result is validated at runtime by `npm run build` and again by
 * `tests/system/`, which executes this exact artifact against the real
 * registration facade in a browser.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(
	await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8'),
);

/** The module-table global installed by the page shell before any bundle runs. */
const LOADER_GLOBAL = 'window.__ModuleLoader__';

const banner = [
	`${LOADER_GLOBAL}.load({`,
	`\tid: ${JSON.stringify(pkg.name)},`,
	'\tfactory: (require) => {',
].join('\n');

const footer = [
	'',
	'\t\treturn { apply, inject };',
	'\t},',
	'});',
	'',
].join('\n');

const shared = {
	bundle: true,
	target: ['chrome120'],
	platform: 'browser',
	logLevel: 'warning',
	legalComments: 'none',
};

await mkdir(join(root, 'lib'), { recursive: true });

// Host half: one self-contained ESM entry for the Loader row.
await build({
	...shared,
	format: 'esm',
	platform: 'node',
	target: ['node20'],
	entryPoints: [join(root, 'src/index.ts')],
	outfile: join(root, 'lib/index.js'),
});

// Browser half: the envelope documented above.
//
// The build intentionally emits unwrapped statements (no `format`) so they land
// directly in the factory body. An `iife` format would wrap them in a function
// call whose result is discarded, silently swallowing the factory's `return` —
// the guard below exists to catch exactly that.
const client = await build({
	...shared,
	format: 'esm',
	entryPoints: [join(root, 'src/client.ts')],
	write: false,
	banner: { js: banner },
	footer: { js: footer },
});

const [artifact] = client.outputFiles;
if (artifact === undefined) throw new Error('client build produced no output');

// The ESM build is the right shape but carries a trailing `export { ... }`
// statement, which is illegal inside the factory function. Remove exactly that
// final statement and leave everything else untouched.
const exported = artifact.text.replace(/\n*^export\s*\{[^}]*\};?\s*$/m, '\n');
if (exported === artifact.text) {
	throw new Error('client build carried no export statement to strip; the bundler output changed');
}
const code = `${exported.trimEnd()}\n`;

// Fail the build, not the browser: an unenveloped or non-returning factory is
// the exact defect this file exists to prevent.
if (!code.startsWith(`${LOADER_GLOBAL}.load({`)) {
	throw new Error('client bundle does not open the module-table envelope');
}
if (!/^\s*return\b/m.test(code)) {
	throw new Error('client factory never returns its exports');
}
// The footer names these two bindings; if the bundler ever renames or drops
// them, the page would fail at boot with a ReferenceError instead.
if (!/^\s*function apply\s*\(/m.test(code)) {
	throw new Error('client bundle no longer declares a top-level `apply` function');
}
if (!/^\s*var inject\s*=/m.test(code)) {
	throw new Error('client bundle no longer declares a top-level `inject` binding');
}
if (/^\s*export\b/m.test(code) || /^\s*import\b/m.test(code)) {
	throw new Error('client bundle contains a top-level ESM declaration inside a plain function');
}
// A bare `ow.` is the in-repo bundler's local alias for the same global; it is
// declared inside first-party output and does not exist here. `window.` ends in
// "ow", so the check needs a word boundary to avoid matching itself.
if (/(^|[^\w.$])ow\s*\./.test(code)) {
	throw new Error('client bundle references the in-repo bundler alias instead of the page global');
}

const { writeFile } = await import('node:fs/promises');
await writeFile(join(root, 'lib/client.js'), code);

const bytes = Buffer.byteLength(code);
console.log(`built lib/index.js and lib/client.js (${bytes} bytes)`);
