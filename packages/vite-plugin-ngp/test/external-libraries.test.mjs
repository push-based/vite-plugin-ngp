// `test.externalLibraries` leaves Angular libraries to Node under Vitest, and links each one as
// Node loads it, from the output cache (link-hook.ts). Vitest then never transforms a library,
// which it would do once per project. These run test/fixtures/vitest-specs that way. Run
// `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import * as fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {copyFixture, toolchain} from './fixture.mjs';

const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

/**
 * Runs `vitest run <specs>` in `root`, a copy of the fixture, with `testOptions` as the plugin's
 * `test` option and `cache` as its `cache`. Vitest's own module cache goes inside the copy, so
 * it starts empty and can be read afterwards.
 */
async function run(root, specs, {testOptions = {externalLibraries: true}, cache = true, args = []} = {}) {
  try {
    const {stdout, stderr} = await promisify(execFile)(process.execPath, [vitestBin, 'run', ...specs, '--fsModuleCachePath', path.join(root, '.vitest-cache'), ...args], {
      cwd: root,
      env: {...process.env, NO_COLOR: '1', NGP_TOOLCHAIN: toolchain, NGP_TEST_OPTIONS: JSON.stringify(testOptions), NGP_CACHE: JSON.stringify(cache)},
    });
    return {ok: true, output: stdout + stderr};
  } catch (error) {
    return {ok: false, output: `${error.stdout}${error.stderr}`};
  }
}

/** The linker's entries under `dir`: those with code and no diagnostics. */
async function linkedEntries(dir) {
  const names = (await fs.readdir(dir, {recursive: true})).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(names.map(async (name) => ({file: path.join(dir, name), value: JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))})));
  return all.filter((e) => e.value.result && !Array.isArray(e.value.result.diagnostics));
}

/** How many modules in Vitest's own cache for `root` came from an Angular package. */
async function librariesVitestTransformed(root) {
  const dir = path.join(root, '.vitest-cache');
  const names = await fs.readdir(dir, {recursive: true}).catch(() => []);
  let count = 0;
  for (const name of names) {
    const content = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '');
    count += /node_modules\/@angular\/[^"']+\/fesm2022\//.test(content) ? 1 : 0;
  }
  return count;
}

test('libraries stay out of Vitest, and a second project runs the code the first one linked', async () => {
  const first = await copyFixture('vitest-specs', 'external-first');
  const second = await copyFixture('vitest-specs', 'external-second');
  const dir = path.join(path.dirname(first), 'shared-cache-external');
  await fs.rm(dir, {recursive: true, force: true});

  const cold = await run(first, ['src/counter.spec.ts', 'src/projection.spec.ts'], {cache: {dir}});
  assert.equal(cold.ok, true, cold.output);
  assert.match(cold.output, /2 passed/);
  assert.equal(await librariesVitestTransformed(first), 0, 'Vitest transformed no Angular library');
  const linked = await linkedEntries(dir);
  assert.ok(linked.length > 0, 'the hook linked libraries into the output cache');

  // A library read from a marked entry leaves a file behind when Node runs it.
  const ran = path.join(dir, 'ran-linked');
  for (const entry of linked) {
    entry.value.result.code += `\nimport {writeFileSync as __ngpMark} from 'node:fs';\n__ngpMark(${JSON.stringify(ran)}, '');\n`;
    await fs.writeFile(entry.file, JSON.stringify(entry.value));
  }
  const warm = await run(second, ['src/counter.spec.ts', 'src/projection.spec.ts'], {cache: {dir}});
  assert.equal(warm.ok, true, warm.output);
  await fs.access(ran);
  assert.equal((await linkedEntries(dir)).length, linked.length, 'the second project linked nothing itself');
  assert.equal(await librariesVitestTransformed(second), 0);

  // The hook and the linker transform use one key: a project that inlines its libraries, as
  // the default does, finds every one of them linked already.
  const inlined = await copyFixture('vitest-specs', 'external-inlined');
  const mixed = await run(inlined, ['src/counter.spec.ts', 'src/projection.spec.ts'], {testOptions: {}, cache: {dir}});
  assert.equal(mixed.ok, true, mixed.output);
  assert.equal((await linkedEntries(dir)).length, linked.length, 'the transform read the entries the hook wrote');
});

test('without the option Vitest transforms the libraries itself, which is what the check above counts', async () => {
  const root = await copyFixture('vitest-specs', 'external-off');
  const result = await run(root, ['src/counter.spec.ts'], {testOptions: {}});
  assert.equal(result.ok, true, result.output);
  assert.ok((await librariesVitestTransformed(root)) > 0);
});

test('with jitCompat the hook links for JIT, and overrides see their NgModules', async () => {
  const root = await copyFixture('vitest-specs', 'external-jit');
  const without = await run(root, ['src/override.spec.ts']);
  assert.equal(without.ok, false, 'linked ahead of time, an override sees no NgModule scope, as with inlined libraries');
  assert.match(without.output, /2 failed/);

  const withIt = await run(root, ['src/override.spec.ts', 'src/dashboard.spec.ts'], {testOptions: {externalLibraries: true, jitCompat: true}});
  assert.equal(withIt.ok, true, withIt.output);
  assert.match(withIt.output, /5 passed/);
});

test('works without the output cache, and in worker threads', async () => {
  const root = await copyFixture('vitest-specs', 'external-no-cache');
  const uncached = await run(root, ['src/counter.spec.ts'], {cache: false});
  assert.equal(uncached.ok, true, uncached.output);
  await assert.rejects(fs.access(path.join(root, '.vite/vite-plugin-ngp/cache')), 'cache: false writes nothing');

  const threads = await run(root, ['src/counter.spec.ts', 'src/projection.spec.ts'], {args: ['--pool', 'threads']});
  assert.equal(threads.ok, true, threads.output);
  assert.match(threads.output, /2 passed/);
});

test('a vm pool is refused: it loads external modules past the hook', async () => {
  const root = await copyFixture('vitest-specs', 'external-vm');
  const result = await run(root, ['src/counter.spec.ts'], {args: ['--pool', 'vmThreads']});
  assert.equal(result.ok, false);
  assert.match(result.output, /test\.externalLibraries needs pool 'forks' or 'threads', not 'vmThreads'/);
});
