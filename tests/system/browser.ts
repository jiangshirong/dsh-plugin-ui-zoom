/**
 * Locate a Chromium-based browser for the system tests, and expose a headless
 * "load this page and dump the DOM" runner.
 *
 * The suite deliberately does not bundle a browser: `tests/system` exists to run
 * the built artifact against a real engine, and a developer machine usually
 * already has one. When none is found the suite reports a skip instead of a
 * pass, so a missing browser can never look like a green run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Candidate executables, in preference order, per platform. */
const CANDIDATES: Record<string, string[]> = {
	win32: [
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	],
	darwin: [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
	],
	linux: [
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/microsoft-edge',
	],
};

/**
 * Find an installed Chromium-based browser.
 * @returns the executable path, or undefined when none is installed.
 */
export function findBrowser(): string | undefined {
	return (CANDIDATES[process.platform] ?? []).find((candidate) => existsSync(candidate));
}

/** Options for one page run. */
export interface RunOptions {
	/** Absolute path of the page to load. */
	readonly page: string;
	/** Per-run profile directory, so parallel runs cannot collide. */
	readonly profileDir: string;
	/** Virtual time budget in milliseconds. */
	readonly budgetMs?: number;
}

/** The outcome of one page run. */
export interface RunResult {
	/** The rendered DOM. */
	readonly dom: string;
	/** Process exit code. */
	readonly status: number | null;
	/** Captured stderr. */
	readonly stderr: string;
}

/**
 * Load one page headlessly and return its rendered DOM.
 * @param browser - the executable path from {@link findBrowser}.
 * @param options - the page and run parameters.
 * @returns the run outcome.
 */
export function dumpDom(browser: string, options: RunOptions): RunResult {
	const result = spawnSync(
		browser,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-extensions',
			`--user-data-dir=${options.profileDir}`,
			'--window-size=1200,800',
			`--virtual-time-budget=${options.budgetMs ?? 6000}`,
			'--dump-dom',
			options.page,
		],
		{ encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
	);
	return {
		dom: result.stdout ?? '',
		status: result.status,
		stderr: result.stderr ?? '',
	};
}

/**
 * Read the harness report out of a rendered DOM.
 *
 * The harness writes one `key = value` line per observation into
 * `<pre id="out">`; values are single-line by construction.
 * @param dom - the rendered DOM.
 * @returns the parsed observations, or null when the report is absent.
 */
export function readReport(dom: string): Map<string, string> | null {
	const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
	if (match?.[1] === undefined) return null;
	const decoded = match[1]
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&amp;', '&');
	const report = new Map<string, string>();
	for (const line of decoded.split('\n')) {
		const separator = line.indexOf(' = ');
		if (separator < 0) continue;
		report.set(line.slice(0, separator).trim(), line.slice(separator + 3).trim());
	}
	return report;
}
