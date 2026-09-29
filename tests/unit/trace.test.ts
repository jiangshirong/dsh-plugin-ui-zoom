import { describe, expect, it, vi } from 'vitest';
import { TRACE_KEY, trace, describe as describeError } from '../../src/trace.js';

/** Install a controllable localStorage on the jsdom window. */
function fakeStorage(options: { failRead?: boolean; failWrite?: boolean } = {}) {
	const store = new Map<string, string>();
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => {
				if (options.failRead === true) throw new Error('read blocked');
				return store.get(key) ?? null;
			},
			setItem: (key: string, value: string) => {
				if (options.failWrite === true) throw new Error('write blocked');
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
		},
	});
	return store;
}

/** Current journal, decoded. */
function journal(store: Map<string, string>): unknown {
	const raw = store.get(TRACE_KEY);
	return raw === undefined ? undefined : JSON.parse(raw);
}

describe('trace', () => {
	it('appends entries in order', () => {
		const store = fakeStorage();
		trace('one');
		trace('two');
		trace('three');
		expect(journal(store)).toEqual(['one', 'two', 'three']);
	});

	it('writes under the key the host half mirrors', () => {
		const store = fakeStorage();
		trace('marker');
		expect(TRACE_KEY).toBe('dsh.ui-zoom.trace');
		expect(store.has(TRACE_KEY)).toBe(true);
	});

	it('keeps a bounded journal', () => {
		const store = fakeStorage();
		for (let index = 0; index < 260; index++) trace(`e${String(index)}`);
		const entries = journal(store) as string[];
		expect(entries.length).toBe(200);
		// The newest entries survive; the oldest are dropped.
		expect(entries.at(-1)).toBe('e259');
		expect(entries).not.toContain('e0');
	});

	it('recovers from a corrupt stored value', () => {
		const store = fakeStorage();
		store.set(TRACE_KEY, '{ not json');
		trace('after-corruption');
		expect(journal(store)).toEqual(['after-corruption']);
	});

	it('ignores a stored value that is not an array', () => {
		const store = fakeStorage();
		store.set(TRACE_KEY, JSON.stringify({ entries: ['x'] }));
		trace('after-object');
		expect(journal(store)).toEqual(['after-object']);
	});

	it('drops non-string members of a stored array', () => {
		const store = fakeStorage();
		store.set(TRACE_KEY, JSON.stringify(['kept', 7, null, { a: 1 }]));
		trace('appended');
		expect(journal(store)).toEqual(['kept', 'appended']);
	});

	it('never throws when the store refuses to read', () => {
		fakeStorage({ failRead: true });
		expect(() => trace('x')).not.toThrow();
	});

	it('never throws when the store refuses to write', () => {
		fakeStorage({ failWrite: true });
		expect(() => trace('x')).not.toThrow();
	});

	it('containment is what makes it safe to call from a hot path', () => {
		const setItem = vi.fn(() => {
			throw new Error('quota exceeded');
		});
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			value: { getItem: () => '[]', setItem, removeItem: () => {} },
		});
		expect(() => trace('hot')).not.toThrow();
		expect(setItem).toHaveBeenCalled();
	});
});

describe('describe', () => {
	it('renders an Error as name and message', () => {
		expect(describeError(new TypeError('bad shape'))).toBe('TypeError:bad shape');
	});

	it('stringifies anything else', () => {
		expect(describeError('plain')).toBe('plain');
		expect(describeError(42)).toBe('42');
		expect(describeError(undefined)).toBe('undefined');
	});

	it('stays on one line so the journal remains line-oriented', () => {
		expect(describeError(new Error('first\nsecond'))).not.toContain('\n');
	});
});
