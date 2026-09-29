/**
 * System tests: run the BUILT browser bundle against the real page contract in a
 * real engine.
 *
 * Motivated by two defects that unit tests and type checking cannot see, because
 * both are properties of the bundle envelope rather than of the code inside it:
 *
 * 1. A bundle that reaches the module table through a bundler-local alias
 *    instead of the page global dies at boot with `ReferenceError: ow is not
 *    defined`, and the whole client fails to activate.
 * 2. A factory whose return value is not the package exports yields
 *    `undefined`, so the row never mounts (`import failed`).
 *
 * The suite skips (rather than passes) when no browser is installed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dumpDom, findBrowser, readReport } from './browser.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const bundlePath = join(root, 'lib/client.js');
const harnessPath = join(root, 'tests/system/page.html');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const browser = findBrowser();
const scratch = mkdtempSync(join(tmpdir(), 'dsh-ui-zoom-system-'));

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe.skipIf(browser === undefined)('the built browser bundle in a real engine', () => {
	let report: Map<string, string>;
	let source: string;

	beforeAll(() => {
		source = readFileSync(bundlePath, 'utf8');
		const harness = readFileSync(harnessPath, 'utf8');
		if (!harness.includes('/*__BUNDLE__*/')) {
			throw new Error('tests/system/page.html is missing its /*__BUNDLE__*/ placeholder');
		}
		const file = join(scratch, 'harness.html');
		// A replacer function keeps `$&`-style sequences inside the bundle literal.
		writeFileSync(file, harness.replace('/*__BUNDLE__*/', () => source), 'utf8');
		const result = dumpDom(browser as string, {
			page: `file:///${file.replaceAll('\\', '/')}`,
			profileDir: join(scratch, 'profile'),
			budgetMs: 12_000,
		});
		const parsed = readReport(result.dom);
		if (parsed === null) {
			throw new Error(
				`the harness produced no report (exit ${String(result.status)})\n${result.stderr.slice(0, 4000)}`,
			);
		}
		report = parsed;
	});

	// Each assertion below maps to one documented promise of the plugin; the first
	// two are the boot-fatal ones.

	it('registers exactly one factory for the package name', () => {
		expect(report.get('fatal')).toBeUndefined();
		expect(report.get('registrations')).toBe('1');
		expect(report.get('id')).toBe(pkg.name);
		expect(report.get('factoryType')).toBe('function');
	});

	it('materializes without requesting any external module', () => {
		expect(report.get('factoryThrew')).toBeUndefined();
		expect(report.get('externalRequests')).toBe('(none)');
	});

	it('returns the package exports from the factory', () => {
		expect(report.get('pluginType')).toBe('object');
		expect(report.get('hasApply')).toBe('true');
		expect(JSON.parse(report.get('inject') ?? 'null')).toEqual(pkg.dsh.client.inject);
	});

	it('applies without throwing and registers all three commands', () => {
		expect(report.get('applyThrew')).toBeUndefined();
		expect(report.get('registeredCommands')).toBe('view.zoomIn,view.zoomOut,view.zoomReset');
	});

	it('leaves the document unscaled at rest', () => {
		expect(report.get('afterCtrlA')).toBe('(none)');
	});

	it('zooms in on Ctrl+= and out on Ctrl+-', () => {
		expect(report.get('afterCtrlEqual')).toBe('1.1');
		expect(report.get('afterTwice')).toBe('1.25');
		// The previous rung was 1.75 (numeric pad), so one step down is 1.5.
		expect(report.get('afterCtrlMinus')).toBe('1.5');
	});

	it('accepts the shifted plus spelling and the numeric pad', () => {
		// Ctrl+Shift+= is the `+` glyph on the same physical key, and the numeric pad
		// is reachable only through the DOM listener.
		expect(report.get('afterShiftEqual')).toBe('1.5');
		expect(report.get('afterNumpadAdd')).toBe('1.75');
		expect(report.get('afterNumpadSubtract')).toBe('1.25');
	});

	it('resets to 100% and removes the declaration', () => {
		expect(report.get('afterCtrlZero')).toBe('(none)');
	});

	it('actually scales rendering, not just the declaration', () => {
		// The declaration could be accepted yet do nothing; the geometry is the proof.
		expect(report.get('renderedAtRest')).toBe('200');
		expect(report.get('renderedAt110')).toBe('220');
		expect(report.get('renderedAfterReset')).toBe('200');
	});

	it('keeps an anchored floating layer on its anchor at every scale', () => {
		// The regression that forced the transform mechanism: `zoom` lands inside
		// getBoundingClientRect(), so a layer positioned from a measured rect was
		// scaled a second time and walked away from its anchor as the scale grew.
		for (const key of [
			'gapAtRest',
			'gapAt110',
			'gapAt125',
			'gapAt175',
			'gapAfterReset',
			'gapAtClampedTop',
			'gapAtClampedBottom',
		]) {
			expect({ key, gap: report.get(key) }).toEqual({ key, gap: '8' });
		}
	});

	it('keeps the shell covering the window at every scale', () => {
		// A transform does not reflow, so without the inverse sizing the shell would
		// leave a gap at the right and bottom edges.
		expect(report.get('shellCoversW')).toBe('true');
		expect(report.get('shellCoversH')).toBe('true');
		expect(report.get('shellCoversAtTop')).toBe('true');
		expect(report.get('shellCoversAtBottom')).toBe('true');
	});

	it('ignores bare, unrelated, and Alt-modified presses', () => {
		expect(report.get('afterBareEqual')).toBe('(none)');
		expect(report.get('afterCtrlA')).toBe('(none)');
		expect(report.get('afterCtrlAltMinus')).toBe('(none)');
	});

	it('persists the accepted scale under the documented key', () => {
		expect(report.get('storedValue')).toBe('1.1');
	});

	it('installs its overflow lock while scaled', () => {
		expect(report.get('overflowLock')).toBe('true');
	});

	it('clamps at both ends of the ladder', () => {
		expect(report.get('clampedTop')).toBe('2');
		expect(report.get('clampedBottom')).toBe('0.5');
	});

	it('does not reach the module table through a bundler-local alias', () => {
		// `ow` is the in-repo bundler's local alias; copying it produced
		// `ReferenceError: ow is not defined` at boot in an earlier revision.
		expect(/(^|[^\w.$])ow\s*\./.test(source)).toBe(false);
		expect(source.startsWith('window.__ModuleLoader__.load(')).toBe(true);
	});
});

describe.skipIf(browser !== undefined)('browser availability', () => {
	it('reports that no Chromium-based browser was found', () => {
		console.warn(
			'tests/system: no Chromium-based browser found; the built bundle was NOT exercised. ' +
				'Install Chrome/Edge/Chromium or set one on PATH to run this suite.',
		);
		expect(browser).toBeUndefined();
	});
});
