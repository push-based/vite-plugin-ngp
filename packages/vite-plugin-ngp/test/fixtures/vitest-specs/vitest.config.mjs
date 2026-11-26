// Run by test/vitest-options.test.mjs and test/shared-cache.test.mjs, from a copy in test/.tmp.
// NGP_TEST_OPTIONS is the plugin's `test` option as JSON, and NGP_CACHE its `cache` option.
import {defineConfig} from 'vitest/config';
import {ngp} from '../../../dist/index.js';

export default defineConfig({
  // Its own cache: without it Vite falls back to a node_modules/.vite that parallel test files share.
  cacheDir: '.vite',
  plugins: [ngp({toolchain: process.env.NGP_TOOLCHAIN, cache: JSON.parse(process.env.NGP_CACHE ?? 'true'), test: JSON.parse(process.env.NGP_TEST_OPTIONS ?? '{}')})],
  test: {environment: 'node', setupFiles: ['src/setup.ts']},
});
