/**
 * Zoom scale arithmetic and preference persistence.
 *
 * Deliberately DOM-free so the ladder, clamping, and storage rules can be
 * unit-tested without a browser. The client half owns the only DOM writes.
 */

/**
 * The supported scale ladder; `1` is the untouched layout.
 *
 * Typed as `readonly number[]` rather than a tuple of literals: the ladder is
 * data, and a literal union would make every value read out of it narrower than
 * the `number` this module's arithmetic produces.
 */
export const SCALES: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Smallest supported scale. */
export const MIN_SCALE = SCALES[0] ?? 0.5;

/** Largest supported scale. */
export const MAX_SCALE = SCALES[SCALES.length - 1] ?? 1;

/** Scale used when nothing is stored or the stored value is unusable. */
export const DEFAULT_SCALE = 1;

/** localStorage key holding the accepted scale. */
export const STORAGE_KEY = 'dsh.ui-zoom.scale';

/** The direction of one ladder step. */
export type Step = -1 | 1;

/**
 * Clamp an arbitrary number into the supported range.
 * @param value - the candidate scale.
 * @returns the value held inside `[MIN_SCALE, MAX_SCALE]`.
 */
export function clamp(value: number): number {
	if (Number.isNaN(value)) return DEFAULT_SCALE;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/**
 * Snap a scale to the nearest rung.
 *
 * The ladder is the single source of truth for every value this plugin writes,
 * so a hand-edited preference or a future ladder change can never leave the
 * document at a scale that has no step.
 * @param value - the candidate scale.
 * @returns the nearest rung.
 */
export function nearestScale(value: number): number {
	if (Number.isNaN(value)) return DEFAULT_SCALE;
	let best: number = DEFAULT_SCALE;
	for (const candidate of SCALES) {
		if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
	}
	return best;
}

/**
 * Index of the rung a scale snaps to.
 * @param value - the candidate scale.
 * @returns the rung index.
 */
export function scaleIndex(value: number): number {
	return SCALES.indexOf(nearestScale(value));
}

/**
 * Move one rung, stopping at either end.
 * @param value - the current scale.
 * @param step - `1` to zoom in, `-1` to zoom out.
 * @returns the next rung, or the same rung when already at the end.
 */
export function stepScale(value: number, step: Step): number {
	const next = scaleIndex(value) + step;
	const held = Math.min(SCALES.length - 1, Math.max(0, next));
	return SCALES[held] ?? DEFAULT_SCALE;
}

/** Human-readable percentage of a scale, e.g. `125`. */
export function scalePercent(value: number): number {
	return Math.round(nearestScale(value) * 100);
}

/** Scale persistence, injectable so tests can avoid a real browser store. */
export interface ScaleStorage {
	/** @returns the stored scale, or null when absent. */
	read(): number | null;
	/** @param value - the accepted scale. */
	write(value: number): void;
}

/**
 * Narrow an unknown stored value to a supported scale.
 * @param raw - the stored string.
 * @returns the accepted scale.
 */
export function parseStored(raw: string | null): number {
	if (raw === null) return DEFAULT_SCALE;
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_SCALE;
	return nearestScale(clamp(parsed));
}

/**
 * A storage backed by `window.localStorage`.
 *
 * Every operation is best-effort: a browser that refuses storage (private mode,
 * blocked origin) must degrade to a session-only preference, never to a broken
 * zoom, so failures are swallowed and reported through the return value.
 * @param getItem - the read function, bound to its owner.
 * @param setItem - the write function, bound to its owner.
 * @returns the storage adapter.
 */
export function createStorage(
	getItem: (key: string) => string | null,
	setItem: (key: string, value: string) => void,
): ScaleStorage {
	return {
		read() {
			try {
				return parseStored(getItem(STORAGE_KEY));
			} catch {
				return DEFAULT_SCALE;
			}
		},
		write(value) {
			try {
				setItem(STORAGE_KEY, String(value));
			} catch {
				/* storage unavailable; the scale still applies for this session */
			}
		},
	};
}
