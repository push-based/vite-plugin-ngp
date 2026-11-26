// The output cache keeps compiled modules between builds (decision 66 in docs/decisions.md). These
// check that a second build reads from it, that the output is the same, and that each kind of
// input the key covers makes a miss when it changes. Builds test/fixtures/ng-build-app. Run
// `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {test} from 'node:test';
import fsPromises from 'node:fs/promises';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {cacheScope, OutputCache, stableJson} from '../dist/output-cache.js';
import {ngp} from '../dist/index.js';
import {build, copyFixture, readOutput, toolchain} from './fixture.mjs';

/** A statement Rolldown keeps, so a cached module that carries it shows in the bundle. */
const MARKER = '\nglobalThis.__ngpCacheMarker = "from-cache";\n';

test('stableJson drops the analyzer ids and spans', () => {
  const value = {
    fileId: 3,
    classes: [{symbolId: 9, className: 'App', span: {start: 1, end: 2}, nameSpan: {start: 1, end: 4}, removalSpans: [], selector: 'app-root'}],
    filePath: '/work/app/src/app.ts',
  };
  assert.equal(stableJson(value), '{"classes":[{"className":"App","selector":"app-root"}],"filePath":"/work/app/src/app.ts"}');
  // The same analysis from another run, with other ids and the class moved down a line.
  const again = {...value, fileId: 7, classes: [{...value.classes[0], symbolId: 2, span: {start: 20, end: 21}}]};
  assert.equal(stableJson(again), stableJson(value));
});

test('a key changes with its scope and with any part', () => {
  const a = new OutputCache('/nowhere', 'scope-a');
  const b = new OutputCache('/nowhere', 'scope-b');
  assert.equal(a.key(['x', {y: 1}]), a.key(['x', {y: 1}]));
  assert.notEqual(a.key(['x', {y: 1}]), a.key(['x', {y: 2}]));
  assert.notEqual(a.key(['x']), b.key(['x']));
});

test('the scope names the compiler-cli that links, the one the plugin resolves, whatever the root', () => {
  const linker = createRequire(new URL('../dist/linker.js', import.meta.url)).resolve('@angular/compiler-cli/package.json');
  const {version} = createRequire(import.meta.url)(linker);
  // A root with no Angular in reach still gets the linker's version, not 'unknown'.
  for (const root of [process.cwd(), '/']) {
    assert.equal(JSON.parse(cacheScope(root)).linker, version);
  }
});

test('builds read the cache, and miss when a template, a used input or the code changes', async () => {
  const root = await copyFixture('ng-build-app', 'cache');
  const cacheDir = path.join(root, '.vite/vite-plugin-ngp/cache');
  const output = async () => (await readOutput(path.join(root, 'dist'))).sort((x, y) => x.name.localeCompare(y.name));
  const bundle = async () => (await output()).map((f) => f.content).join('\n');

  await build(root, {});
  const first = await output();
  assert.ok((await entries(cacheDir)).length > 0, 'the first build wrote cache entries');

  // Byte-identical output from the cache.
  await build(root, {});
  assert.deepEqual(await output(), first);

  // Prove the second build read the cache: mark App's entry, and the marker reaches the bundle.
  await markEntry(cacheDir, 'app-root');
  await build(root, {});
  assert.match(await bundle(), /__ngpCacheMarker/, "App's compiled code came from the cache");

  // A change to the constant Banner's template reads from: Banner misses, App still hits, since
  // Banner's selector, inputs and outputs are what App's output depends on.
  const environment = path.join(root, 'src/environments/environment.ts');
  const original = await fs.readFile(environment, 'utf8');
  await fs.writeFile(environment, original.replace('development banner', 'edited banner'));
  await build(root, {});
  assert.match(await bundle(), /edited banner/, 'Banner was compiled again');
  assert.match(await bundle(), /__ngpCacheMarker/, 'App was not');

  // A comment in Banner's file: App's key doesn't see it.
  const banner = path.join(root, 'src/banner.ts');
  const bannerSource = await fs.readFile(banner, 'utf8');
  await fs.writeFile(banner, `// a comment\n${bannerSource}`);
  await build(root, {});
  assert.match(await bundle(), /__ngpCacheMarker/, 'App still came from the cache');

  // A new input on Banner is part of App's key: App misses and is compiled fresh.
  await fs.writeFile(banner, bannerSource.replace("import {Component} from '@angular/core';", "import {Component, Input} from '@angular/core';").replace('export class Banner {}', 'export class Banner {\n  @Input() tone = \'\';\n}'));
  await build(root, {});
  assert.doesNotMatch(await bundle(), /__ngpCacheMarker/, 'App was compiled again');
});

test('a cache copied to another path is not read: compiled modules name their stylesheets by absolute path', async () => {
  const first = await copyFixture('ng-build-app', 'cache-moved-from');
  await build(first, {});
  const second = path.join(path.dirname(first), 'ng-build-app-cache-moved-to');
  await fs.rm(second, {recursive: true, force: true});
  await fs.cp(first, second, {recursive: true});
  // Gone, so a module compiled for the first path can't find its stylesheet there.
  await fs.rm(first, {recursive: true});
  await build(second, {});
  const bundle = (await readOutput(path.join(second, 'dist'))).map((f) => f.content).join('\n');
  assert.doesNotMatch(bundle, /cache-moved-from/);
});

test('an edited preprocessor misses, even with the same Angular commit in BUILD.json', async () => {
  const root = await copyFixture('ng-build-app', 'cache-preprocessor');
  const cacheDir = path.join(root, '.vite/vite-plugin-ngp/cache');
  // A copy of the ngp build, with the BUILD.json the package ships, so the edit below is like a
  // patch applied to the preprocessor inside node_modules.
  const ngpBuild = path.join(root, 'ngp');
  await fs.cp(toolchain, ngpBuild, {recursive: true});
  await fs.writeFile(path.join(ngpBuild, 'BUILD.json'), JSON.stringify({angularCommit: 'same-commit'}));
  const bundle = async () => (await readOutput(path.join(root, 'dist'))).map((f) => f.content).join('\n');

  await build(root, {toolchain: ngpBuild});
  await markEntry(cacheDir, 'app-root');
  await build(root, {toolchain: ngpBuild});
  assert.match(await bundle(), /__ngpCacheMarker/, 'an unchanged preprocessor reads the cache');

  // A file deep in the preprocessor, not its entry point.
  const processor = path.join(ngpBuild, 'preprocessor/src/processor.js');
  await fs.appendFile(processor, '\n// patched\n');
  await build(root, {toolchain: ngpBuild});
  assert.doesNotMatch(await bundle(), /__ngpCacheMarker/, 'App was compiled again');
});

test('cache: false writes nothing', async () => {
  const root = await copyFixture('ng-build-app', 'no-cache');
  await build(root, {cache: false});
  await assert.rejects(fs.access(path.join(root, '.vite/vite-plugin-ngp/cache')));
});

test('cache.dir names the directory, from Vite\'s root, and a second build reads it', async () => {
  const root = await copyFixture('ng-build-app', 'cache-dir');
  const cacheDir = path.join(root, 'kept/ngp');
  const bundle = async () => (await readOutput(path.join(root, 'dist'))).map((f) => f.content).join('\n');

  await build(root, {cache: {dir: 'kept/ngp'}});
  assert.ok((await entries(cacheDir)).length > 0, 'the build wrote its entries to cache.dir');
  await assert.rejects(fs.access(path.join(root, '.vite/vite-plugin-ngp/cache')), 'and none under cacheDir');

  await markEntry(cacheDir, 'app-root');
  await build(root, {cache: {dir: 'kept/ngp'}});
  assert.match(await bundle(), /__ngpCacheMarker/, "App's compiled code came from cache.dir");

  // The same directory by its absolute path, and an empty options object as `true`.
  await build(root, {cache: {dir: cacheDir}});
  assert.match(await bundle(), /__ngpCacheMarker/);
  await build(root, {cache: {}});
  assert.doesNotMatch(await bundle(), /__ngpCacheMarker/, 'without dir, the default directory');
  assert.ok((await entries(path.join(root, '.vite/vite-plugin-ngp/cache'))).length > 0);
});

test('cache.dir has to be a path, and not the root or a folder the root is in', async () => {
  for (const dir of ['', '  ', 3, null]) {
    assert.throws(() => ngp({toolchain, cache: {dir}}), /cache\.dir must be a path/, JSON.stringify(dir));
  }
  // Entries there would land among the sources: the workspace root passed as the directory, say.
  const root = await copyFixture('ng-build-app', 'cache-dir-root');
  for (const dir of ['.', '..', root, path.dirname(root)]) {
    await assert.rejects(build(root, {cache: {dir}}), /cache\.dir is .*, which holds Vite's root/, dir);
  }
  assert.deepEqual((await fs.readdir(root)).sort(), (await fs.readdir(path.join(root, '../../fixtures/ng-build-app'))).sort(), 'nothing was written to the root');
});

test('two caches on one directory write the same entries at once, and every one reads back whole', async () => {
  const dir = path.join(await copyFixture('ng-build-app', 'cache-writers'), 'kept');
  const caches = [new OutputCache(dir, 'scope'), new OutputCache(dir, 'scope')];
  const value = {result: {code: 'x'.repeat(200_000)}};
  const keys = Array.from({length: 40}, (_, i) => caches[0].key(['entry', i]));
  // Both count their writes from zero, as two plugins in one Vitest process do. Without an id
  // per cache they'd write each entry through one temporary file, and still pass the checks
  // below most of the time, so the names themselves are checked too.
  const temporary = [];
  const writeFile = fsPromises.writeFile;
  fsPromises.writeFile = (file, ...rest) => {
    temporary.push(String(file));
    return writeFile(file, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await Promise.all(caches.flatMap((cache) => keys.map((key) => cache.put(key, value))));
  } finally {
    fsPromises.writeFile = writeFile;
    syncBuiltinESMExports();
  }
  assert.equal(temporary.length, 80);
  assert.equal(new Set(temporary).size, 80, 'every write went to a temporary file of its own');
  for (const key of keys) {
    assert.deepEqual(await caches[1].get(key), value);
  }
  assert.deepEqual((await fs.readdir(dir, {recursive: true})).filter((f) => f.endsWith('.tmp')), [], 'no temporary file left behind');
});

/** Every entry under `dir`, with its path and parsed value. */
async function entries(dir) {
  const names = (await fs.readdir(dir, {recursive: true})).filter((f) => f.endsWith('.json'));
  return Promise.all(names.map(async (name) => ({file: path.join(dir, name), value: JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))})));
}

/**
 * Appends the marker to the ngp entry whose compiled code mentions `selector`. ngp entries carry
 * diagnostics; the linker's and optimizer's don't.
 */
async function markEntry(dir, selector) {
  const all = await entries(dir);
  const matches = all.filter((e) => Array.isArray(e.value.result?.diagnostics) && e.value.result.code.includes(selector));
  assert.equal(matches.length, 1, `one ngp entry for ${selector}, found ${matches.length}`);
  const [entry] = matches;
  entry.value.result.code += MARKER;
  await fs.writeFile(entry.file, JSON.stringify(entry.value));
}
