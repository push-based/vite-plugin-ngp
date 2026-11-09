// The output cache keeps compiled modules between builds (decision 66 in docs/decisions.md). These
// check that a second build reads from it, that the output is the same, and that each kind of
// input the key covers makes a miss when it changes. Builds test/fixtures/ng-build-app. Run
// `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {test} from 'node:test';
import {OutputCache, stableJson} from '../dist/output-cache.js';
import {build, copyFixture, readOutput} from './fixture.mjs';

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

test('cache: false writes nothing', async () => {
  const root = await copyFixture('ng-build-app', 'no-cache');
  await build(root, {cache: false});
  await assert.rejects(fs.access(path.join(root, '.vite/vite-plugin-ngp/cache')));
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
