/**
 * Reading the browser half's journal out of the renderer's local storage.
 *
 * Chromium stores localStorage values as UTF-16LE text inside its Local Storage
 * leveldb files, so the journal a browser half writes is recoverable from disk
 * without the renderer's cooperation. That matters because a sandboxed renderer
 * is otherwise opaque: its console cannot be read, and the application crash
 * report covers only application-fatal errors.
 *
 * DOM-free and Node-only, so the parsing rules can be unit-tested directly.
 */

/** Journal key the browser half writes under. */
export const TRACE_KEY = 'dsh.ui-zoom.trace';

/** How many bytes of a value to consider. */
const WINDOW = 65_536;

/**
 * Decode every JSON array payload that follows the journal key in one log file.
 *
 * A leveldb log is a sequence of records, so the same key can appear many
 * times; each occurrence is decoded independently and the caller deduplicates.
 * A truncated trailing record simply yields no payload.
 * @param raw - the file bytes.
 * @param key - the storage key to look for.
 * @returns decoded payloads in file order.
 */
export function readJournalPayloads(raw: Buffer, key: string = TRACE_KEY): string[] {
	const needle = Buffer.from(key, 'utf16le');
	const found: string[] = [];
	let from = 0;
	for (;;) {
		const at = raw.indexOf(needle, from);
		if (at < 0) return found;
		from = at + needle.length;
		const text = raw.subarray(from, from + WINDOW).toString('utf16le');
		const start = text.indexOf('[');
		if (start < 0) continue;
		let depth = 0;
		for (let index = start; index < text.length; index++) {
			const char = text[index];
			if (char === '[') depth++;
			else if (char === ']') {
				depth--;
				if (depth === 0) {
					found.push(text.slice(start, index + 1));
					break;
				}
			}
		}
	}
}

/**
 * Encode one key/value pair the way Chromium's log would hold it.
 *
 * Test-only helper: it keeps the parsing rules honest against the encoding they
 * are written for, instead of against a hand-waved fixture.
 * @param key - storage key.
 * @param value - the stored string.
 * @returns the record bytes.
 */
export function encodeJournalRecord(key: string, value: string): Buffer {
	return Buffer.concat([
		Buffer.from([0x01, 0x00, 0x00, 0x00]),
		Buffer.from(`_https://dsh-app://app\u0000\u0001${key}\u0000`, 'utf16le'),
		Buffer.from(value, 'utf16le'),
		Buffer.from('\u0000\u0000', 'utf16le'),
	]);
}
