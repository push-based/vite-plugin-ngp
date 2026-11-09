// Under Vitest the plugin compiles a spec and what it imports, on demand, and nothing else
// (docs/decisions.md, "Compile specs on demand under Vitest"). This runs the playground's specs
// filtered to one file, and reads which modules ngp compiled from the plugin's DEBUG log. Run
// `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const playground = path.join(repo, 'playground');
const vitestBin = path.join(path.dirname(createRequire(path.join(playground, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs');

/** Runs `vitest run <filter>` in the playground and returns every module ngp saw, sorted. */
async function modulesSeen(filter) {
  const {stderr} = await promisify(execFile)(process.execPath, [vitestBin, 'run', '--project', 'server', filter], {
    cwd: playground,
    env: {...process.env, DEBUG: 'vite-plugin-ngp', NGP_TOOLCHAIN: process.env.NGP_TOOLCHAIN ?? path.join(repo, 'toolchain/out')},
  });
  // A module the output cache served is logged as `reused`: it was asked for all the same, so it
  // counts as compiled here, and the test reads the same with a warm cache as with a cold one.
  return [...stderr.matchAll(/^vite-plugin-ngp (compiled|reused|unchanged) (\S+)/gm)].map((m) => `${m[1] === 'reused' ? 'compiled' : m[1]} ${m[2]}`).sort();
}

test('a run filtered to one spec compiles only what that spec imports', async () => {
  assert.deepEqual(await modulesSeen('src/app/pages/components/rating.spec.ts'), [
    'compiled src/app/pages/components/rating.spec.ts',
    'compiled src/app/pages/components/rating.ts',
    'compiled src/app/ui/icon.ts',
    'unchanged src/testing/server.ts',
  ]);
  assert.deepEqual(await modulesSeen('src/app/core/toast.spec.ts'), [
    'compiled src/app/core/toast.ts',
    'unchanged src/app/core/toast.spec.ts',
    'unchanged src/testing/server.ts',
  ]);
});
