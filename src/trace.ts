/**
 * Write-only diagnostic trace.
 *
 * A sandboxed renderer is opaque from the outside: an activation failure is
 * logged to a console nobody can read, and the Host's own crash report only
 * covers application-fatal errors. The one channel a browser half controls
 * without any service dependency is the origin's own storage, so this module
 * appends a compact journal there. The Host half copies it to
 * `$DSH_HOME/ui-zoom-trace.log`, which makes "did the browser half run, and how
 * far did it get" answerable from outside.
 *
 * Nothing here may throw: diagnostics must never be the reason a plugin fails.
 */

/** Storage key holding the journal. */
export const TRACE_KEY = 'dsh.ui-zoom.trace';

/** Upper bound on retained entries, so the file cannot grow without limit. */
const LIMIT = 200;

/** Install the trace key under, when no storage is available. */
const memory: string[] = [];

/** Read the current journal, tolerating any stored shape. */
function read(): string[] {
	try {
		if (typeof window === 'undefined') return [...memory];
		const raw = window.localStorage.getItem(TRACE_KEY);
		const parsed: unknown = raw === null ? [] : JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Append one entry.
 * @param code - a short ASCII marker; keep it free of separators.
 */
export function trace(code: string): void {
	try {
		const next = [...read(), code].slice(-LIMIT);
		window.localStorage.setItem(TRACE_KEY, JSON.stringify(next));
	} catch {
		memory.push(code);
	}
}

/**
 * Describe a thrown value compactly.
 *
 * Line breaks are collapsed because the mirrored journal is line-oriented — one
 * payload per line — so a multi-line message would break its structure.
 * @param error - the caught value.
 * @returns one line suitable for the journal.
 */
export function describe(error: unknown): string {
	if (error instanceof Error) return `${error.name}:${error.message}`.replace(/\s*\r?\n\s*/g, ' / ');
	return String(error).replace(/\s*\r?\n\s*/g, ' / ');
}
