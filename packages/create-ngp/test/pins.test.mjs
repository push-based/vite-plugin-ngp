// The templates pin what the repo builds and tests the plugin with, so a scaffolded app gets the
// Angular release the plugin's ngp build came from.
import assert from 'node:assert/strict';
import {it} from 'node:test';
import {pinMismatches} from '../scripts/check-pins.mjs';

it('pins the same versions as toolchain/versions.env and the playground', () => {
  assert.deepEqual(pinMismatches(), []);
});
