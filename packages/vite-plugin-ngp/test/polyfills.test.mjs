// polyfills, and zone.js apps in particular: the fixture in test/fixtures/ng-build-app uses
// provideZoneChangeDetection(), so it boots only if zone.js loaded first, and its root component
// reports which zone the code after an `await` ran in. Its own file, because loading zone.js
// patches this process's Promise and timers. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {createServer, isRunnableDevEnvironment} from 'vite';
import {ngp} from '../dist/index.js';
import {polyfillImports, usesZone} from '../dist/polyfills.js';
import {build, copyFixture, readOutput, toolchain} from './fixture.mjs';

const document = '<html><head></head><body><app-root></app-root></body></html>';

test('zone.js decides like the CLI, and the server gets zone.js/node', () => {
  assert.equal(usesZone([]), false);
  assert.equal(usesZone(['@angular/localize/init']), false);
  assert.equal(usesZone(['zone.js']), true);
  // A polyfills file might import zone.js, so the CLI assumes it does.
  assert.equal(usesZone(['src/polyfills.ts']), true);
  assert.deepEqual(polyfillImports(['zone.js', '@angular/localize/init', 'core-js/actual/array/at'], '/app', 'server'), ['zone.js/node', '@angular/localize/init']);
  assert.deepEqual(polyfillImports(['zone.js', 'core-js/actual/array/at'], '/app', 'client'), ['zone.js', 'core-js/actual/array/at']);
});

test('zone.js apps: zone.js loads first and tracks async code, in the build', async () => {
  const root = await copyFixture('ng-build-app', 'zone-build');
  await build(root, {polyfills: ['zone.js'], ssr: true});

  const server = await import(pathToFileURL(path.join(root, 'dist/server/main.server.js')).href);
  // Bootstrapping at all means zone.js loaded before Angular: provideZoneChangeDetection()
  // throws NG0908 without it.
  assert.equal(await server.zoneAfterAwait('/', document), 'angular');

  const client = (await readOutput(path.join(root, 'dist/client'))).filter((f) => f.name.endsWith('.js'));
  const code = client.map((f) => f.content).join('\n');
  assert.ok(code.includes('Zone already loaded'), 'zone.js is in the browser bundle');
  // Every async function, Angular's own included, became a generator.
  assert.ok(!/\basync\s*(function\b|\(|[\w$]+\s*\()/.test(code), 'no async functions left');
});

test('zone.js apps: a server entry named in `ssr` gets zone.js/node without listing it in `entries`', async () => {
  const root = await copyFixture('ng-build-app', 'zone-custom-server-entry');
  await fs.rename(path.join(root, 'src/main.server.ts'), path.join(root, 'src/server.ts'));
  await build(root, {polyfills: ['zone.js'], ssr: {entry: 'src/server.ts'}});

  const code = await fs.readFile(path.join(root, 'dist/server/server.js'), 'utf8');
  assert.ok(/^import "zone\.js\/node";/m.test(code), 'the server entry imports zone.js/node');
  const server = await import(pathToFileURL(path.join(root, 'dist/server/server.js')).href);
  // NG0908 without zone.js, as above.
  assert.equal(await server.zoneAfterAwait('/', document), 'angular');
});

test('zone.js apps: without the async rewrite, code after `await` escapes the zone', async () => {
  const root = await copyFixture('ng-build-app', 'zone-control');
  await build(root, {polyfills: ['zone.js'], ssr: true}, {without: ['vite-plugin-ngp:zone-async']});
  const server = await import(pathToFileURL(path.join(root, 'dist/server/main.server.js')).href);
  assert.equal(await server.zoneAfterAwait('/', document), '<root>');
});

test('zone.js apps: zone.js loads first and tracks async code, in dev', async () => {
  const root = await copyFixture('ng-build-app', 'zone-dev');
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    server: {middlewareMode: true, ws: false},
    plugins: ngp({toolchain, polyfills: ['zone.js'], ssr: true}),
  });
  try {
    const ssr = server.environments.ssr;
    assert.ok(isRunnableDevEnvironment(ssr));
    const entry = await ssr.runner.import('/src/main.server.ts');
    assert.equal(await entry.zoneAfterAwait('/', document), 'angular');

    const main = (await server.environments.client.transformRequest('/src/main.ts'))?.code ?? '';
    // Pre-bundled, zone.js is served as .vite/deps/zone__js.js.
    assert.match(main.split('\n')[0], /^import "[^"]*zone__js\.js/, "zone.js is the browser entry's first import");
    const app = (await server.environments.client.transformRequest('/src/app.ts'))?.code ?? '';
    assert.ok(!/\basync\b/.test(app), 'no async functions left in app.ts');
  } finally {
    await server.close();
  }
});

test('polyfills that are files are imported from the project', async () => {
  const root = await copyFixture('ng-build-app', 'polyfills-file');
  await fs.writeFile(path.join(root, 'src/polyfills.ts'), "(globalThis as any).fixturePolyfill = 'loaded';\nimport 'zone.js';\n");
  await build(root, {polyfills: ['src/polyfills.ts']});
  const code = (await readOutput(path.join(root, 'dist'))).map((f) => f.content).join('\n');
  assert.ok(code.includes('fixturePolyfill'), 'the polyfills file is in the bundle');
  assert.ok(code.includes('Zone already loaded'), 'and so is the zone.js it imports');
});
