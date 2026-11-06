// The `engine` option is checked when the plugin is constructed, before any compiler loads, so a
// typo fails startup instead of running the wasm analyzer. Run `pnpm build` first; needs no ngp
// build.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ngp} from '../dist/index.js';

test('an engine other than native or wasm throws, naming the allowed values and the given one', () => {
  assert.throws(() => ngp({engine: 'natve'}), {
    message: `[vite-plugin-ngp] engine must be 'native' or 'wasm', not "natve"`,
  });
});

test('native, wasm and no engine construct the plugin', () => {
  for (const engine of ['native', 'wasm', undefined]) {
    assert.doesNotThrow(() => ngp({engine}), `engine: ${engine}`);
  }
});
