/**
 * Execute the built browser bundle against the module table the page shell
 * installs, and assert the contract the plugin depends on.
 *
 * This is the gate that catches the two defects that are invisible to unit
 * tests and to TypeScript, because both are properties of the *envelope* rather
 * than of the code inside it:
 *
 * - the bundle must reach the module table through the page global
 *   (`window.__ModuleLoader__`), not through a bundler-local alias;
 * - the factory must RETURN the package exports, because that return value —
 *   not a `module.exports` object — is what the module table stores.
 *
 * Run after `npm run build`; `npm run check` runs it automatically.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const source = readFileSync(join(root, 'lib/client.js'), 'utf8');

const failures = [];

/** @param condition - the assertion result. @param message - failure text. */
function expect(condition, message) {
	if (!condition) failures.push(message);
}

// Reproduce the facade the shell installs in <head> before any bundle runs
// (`bootInjections` in packages/client/modules). A bundle registers into the
// pending queue; the module system later swaps in live registration.
const registrations = [];
const sandbox = {
	window: {},
	console,
	// The client half reads these at module scope only inside functions, so the
	// values here only need to be present for the factory to run.
	localStorage: {
		getItem: () => null,
		setItem: () => {},
	},
};
sandbox.window.__ModuleLoader__ = {
	mode: 'queue',
	pendingQueue: registrations,
	load(registration) {
		registrations.push(registration);
	},
};
// A browser global the bundle touches at materialization only.
sandbox.window.localStorage = sandbox.localStorage;

const context = createContext(sandbox);
try {
	runInContext(source, context, { filename: 'lib/client.js' });
} catch (error) {
	failures.push(`bundle threw while executing: ${String(error)}`);
}

expect(registrations.length === 1, `expected exactly one registration, got ${registrations.length}`);

const registration = registrations[0];
if (registration === undefined) {
	console.error('verify-build: no registration to inspect');
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

expect(
	registration.id === pkg.name,
	`registration id is ${JSON.stringify(registration.id)}, expected ${JSON.stringify(pkg.name)}`,
);
expect(typeof registration.factory === 'function', 'registration carries no factory function');

if (typeof registration.factory === 'function') {
	const requested = [];
	let returned;
	try {
		returned = registration.factory((specifier) => {
			requested.push(specifier);
			throw new Error(`unexpected module request: ${specifier}`);
		});
	} catch (error) {
		failures.push(`factory threw: ${String(error)}`);
	}

	// The browser half is self-contained: a module request would mean the bundle
	// depends on a package the boot graph does not guarantee.
	expect(requested.length === 0, `factory requested external modules: ${requested.join(', ')}`);

	expect(
		returned !== null && typeof returned === 'object',
		`factory returned ${returned === undefined ? 'undefined' : typeof returned}; the module table stores the RETURN value`,
	);

	if (returned !== null && typeof returned === 'object') {
		const face = returned;
		expect(typeof face.apply === 'function', 'exports carry no apply function');
		expect(Array.isArray(face.inject), 'exports carry no inject array');
		if (Array.isArray(face.inject)) {
			expect(
				face.inject.includes('shortcuts') && face.inject.includes('locale'),
				`inject is ${JSON.stringify(face.inject)}, expected to include shortcuts and locale`,
			);
			const declared = pkg.dsh?.client?.inject ?? [];
			expect(
				JSON.stringify([...face.inject].sort()) === JSON.stringify([...declared].sort()),
				`manifest inject ${JSON.stringify(declared)} disagrees with bundle inject ${JSON.stringify(face.inject)}`,
			);
		}
	}

	// The host half must expose an apply for the Loader row as well.
	expect(
		/factory:\s*\(require\)\s*=>/.test(source),
		'factory signature does not match the declared single-`require` contract',
	);
}

if (failures.length > 0) {
	console.error('verify-build: FAILED');
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(
	`verify-build: ok — ${pkg.name} registers exactly one factory, requests no external modules, and returns { apply, inject: ${JSON.stringify(pkg.dsh.client.inject)} }`,
);
