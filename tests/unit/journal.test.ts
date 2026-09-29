import { describe, expect, it } from 'vitest';
import { TRACE_KEY, encodeJournalRecord, readJournalPayloads } from '../../src/journal.js';

describe('readJournalPayloads', () => {
	it('recovers a payload written under the journal key', () => {
		const raw = encodeJournalRecord(TRACE_KEY, JSON.stringify(['M:module', 'A:apply']));
		expect(readJournalPayloads(raw)).toEqual(['["M:module","A:apply"]']);
	});

	it('recovers every record in a log, in file order', () => {
		const raw = Buffer.concat([
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			encodeJournalRecord(TRACE_KEY, '["first"]'),
			Buffer.alloc(64, 0x7f),
			encodeJournalRecord(TRACE_KEY, '["second"]'),
			encodeJournalRecord(TRACE_KEY, '["third"]'),
		]);
		expect(readJournalPayloads(raw)).toEqual(['["first"]', '["second"]', '["third"]']);
	});

	it('ignores records for other keys', () => {
		const raw = Buffer.concat([
			encodeJournalRecord('dsh.ui-zoom.scale', '["1.25"]'),
			encodeJournalRecord('something.else', '["nope"]'),
		]);
		expect(readJournalPayloads(raw)).toEqual([]);
	});

	it('honours an explicit key', () => {
		const raw = encodeJournalRecord('custom.key', '["x"]');
		expect(readJournalPayloads(raw, 'custom.key')).toEqual(['["x"]']);
	});

	it('returns nothing for a truncated trailing record', () => {
		const complete = encodeJournalRecord(TRACE_KEY, '["complete"]');
		const truncated = encodeJournalRecord(TRACE_KEY, '["cut').subarray(0, 40);
		expect(readJournalPayloads(Buffer.concat([complete, truncated]))).toEqual(['["complete"]']);
	});

	it('returns nothing when the key is absent', () => {
		expect(readJournalPayloads(Buffer.alloc(256, 0x41))).toEqual([]);
	});

	it('handles nested arrays inside the payload', () => {
		const value = JSON.stringify([['nested', 'pair'], 'flat']);
		const raw = encodeJournalRecord(TRACE_KEY, value);
		expect(readJournalPayloads(raw)).toEqual([value]);
	});

	it('tolerates a payload that never closes', () => {
		const raw = encodeJournalRecord(TRACE_KEY, '[unterminated');
		expect(readJournalPayloads(raw)).toEqual([]);
	});
});

describe('encodeJournalRecord', () => {
	it('round-trips through the parser it exists to exercise', () => {
		const value = JSON.stringify(['K:Equal:cs', 'A:ready:1.25']);
		expect(readJournalPayloads(encodeJournalRecord(TRACE_KEY, value))).toEqual([value]);
	});
});
