// `cache: {dir}` lets every project of a workspace keep its output in one directory (issue #34).
// These run two projects with different roots on one directory, as a build and as a Vitest run,
// and check both halves of what that promises: the second project reads the libraries the first
// one linked, and never the first one's compiled modules, whose output names its own root. Run
// `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import * as fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {build, copyFixture, readOutput, toolchain} from './fixture.mjs';

const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

/** Every entry under `dir` that holds output, as `{file, value, compiled}`. */
async function entries(dir) {
  const names = (await fs.readdir(dir, {recursive: true})).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(names.map(async (name) => ({file: path.join(dir, name), value: JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))})));
  // ngp's entries carry diagnostics; the linker's and the optimizer's don't. A null result is a
  // module the transform left alone.
  return all.filter((e) => e.value.result).map((e) => ({...e, compiled: Array.isArray(e.value.result.diagnostics)}));
}

/** Appends a statement to every entry, one for compiled modules and another for library code. */
async function mark(dir, {compiled, library}) {
  for (const entry of await entries(dir)) {
    entry.value.result.code += `\n${entry.compiled ? compiled : library}\n`;
    await fs.writeFile(entry.file, JSON.stringify(entry.value));
  }
}

/** An empty directory next to `root`, the copy of a fixture, for projects to share. */
async function sharedDir(root, label) {
  const dir = path.join(path.dirname(root), `shared-cache-${label}`);
  await fs.rm(dir, {recursive: true, force: true});
  return dir;
}

test('two builds with different roots share linked libraries, and not their compiled modules', async () => {
  const first = await copyFixture('ng-build-app', 'shared-first');
  const second = await copyFixture('ng-build-app', 'shared-second');
  const dir = await sharedDir(first, 'build');
  const bundle = async (root) => (await readOutput(path.join(root, 'dist'))).map((f) => f.content).join('\n');

  await build(first, {cache: {dir}});
  const written = await entries(dir);
  assert.ok(written.some((e) => e.compiled) && written.some((e) => !e.compiled), 'compiled modules and library code, in one directory');
  await mark(dir, {compiled: 'globalThis.__ngpCompiledElsewhere = true;', library: 'globalThis.__ngpSharedLibrary = true;'});

  await build(second, {cache: {dir}});
  assert.match(await bundle(second), /__ngpSharedLibrary/, 'the second root read the library code the first one wrote');
  assert.doesNotMatch(await bundle(second), /__ngpCompiledElsewhere/, "and compiled its own modules: the first root's name their own paths");
  const after = await entries(dir);
  assert.equal(after.filter((e) => e.compiled).length, 2 * written.filter((e) => e.compiled).length, 'one compiled entry per module and root');

  // The first root still reads its own.
  await build(first, {cache: {dir}});
  assert.match(await bundle(first), /__ngpCompiledElsewhere/);
});

/**
 * Runs `vitest run src/counter.spec.ts` in `root`, with `dir` as the plugin's cache directory.
 * Vitest keeps linked libraries in a module cache of its own, at the workspace root. Here it gets
 * a directory inside the copy, which starts empty, so every library reaches the plugin in a
 * project's first run, as it does in a project Vitest has never run.
 */
async function runSpec(root, dir) {
  try {
    const {stdout, stderr} = await promisify(execFile)(process.execPath, [vitestBin, 'run', 'src/counter.spec.ts', '--fsModuleCachePath', path.join(root, '.vitest-cache')], {
      cwd: root,
      env: {...process.env, NO_COLOR: '1', NGP_TOOLCHAIN: toolchain, NGP_CACHE: JSON.stringify({dir})},
    });
    return {ok: true, output: stdout + stderr};
  } catch (error) {
    return {ok: false, output: `${error.stdout}${error.stderr}`};
  }
}

test('two Vitest projects with different roots: the second reads the libraries the first one linked', async () => {
  const first = await copyFixture('vitest-specs', 'shared-first');
  const second = await copyFixture('vitest-specs', 'shared-second');
  const dir = await sharedDir(first, 'vitest');
  // A module read from a marked entry leaves a file behind when a worker runs it.
  const marks = {compiled: path.join(dir, 'ran-compiled'), library: path.join(dir, 'ran-library')};
  const leaves = (file) => `import {writeFileSync as __ngpMark} from 'node:fs';\n__ngpMark(${JSON.stringify(file)}, '');`;
  const ran = async (file) => fs.access(file).then(() => true, () => false);

  const cold = await runSpec(first, dir);
  assert.equal(cold.ok, true, cold.output);
  const linked = (await entries(dir)).filter((e) => !e.compiled).length;
  assert.ok(linked > 0, 'the first project linked libraries into the shared directory');
  await mark(dir, {compiled: leaves(marks.compiled), library: leaves(marks.library)});

  const warm = await runSpec(second, dir);
  assert.equal(warm.ok, true, warm.output);
  assert.equal(await ran(marks.library), true, 'the second project ran library code the first one linked');
  assert.equal(await ran(marks.compiled), false, "and none of the first project's compiled modules");
  assert.equal((await entries(dir)).filter((e) => !e.compiled).length, linked, 'the second project linked nothing itself');

  // The mark on compiled modules does show when a project reads them: the first one, again.
  const again = await runSpec(first, dir);
  assert.equal(again.ok, true, again.output);
  assert.equal(await ran(marks.compiled), true);
});
