import { defineConfig } from 'vitest/config';

/**
 * System tests execute the built bundle in a real engine.
 *
 * They are excluded from the default unit run so `npm test` stays fast and
 * browser-independent; `npm run test:system` runs them, and `npm run check`
 * runs both. `npm run build` must have produced `lib/` first.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/system/**/*.test.ts'],
		testTimeout: 180_000,
		hookTimeout: 180_000,
		fileParallelism: false,
	},
});
