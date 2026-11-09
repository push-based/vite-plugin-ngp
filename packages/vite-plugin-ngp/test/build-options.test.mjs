// The `ng build` options the plugin supports: fileReplacements and budgets. Builds and serves the
// fixture in test/fixtures/ng-build-app. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';
import {ngp} from '../dist/index.js';
import {bytes, checkBudgets, formatSize} from '../dist/budgets.js';
import {build, copyFixture, readOutput, recordingLogger, toolchain} from './fixture.mjs';

const fileReplacements = [{replace: 'src/environments/environment.ts', with: 'src/environments/environment.prod.ts'}];

test('fileReplacements reach ngp, not only Vite', async () => {
  const root = await copyFixture('ng-build-app', 'replacements');

  // A compiled template keeps the banner's text but not its markup, and nothing keeps the
  // constant itself, since no decorator reads it at runtime.
  const has = (code, text) => code.includes(text);

  await build(root, {});
  const plain = (await readOutput(path.join(root, 'dist'))).map((f) => f.content).join('\n');
  assert.ok(has(plain, 'development banner') && !has(plain, '<b>development banner</b>'), 'compiled the development banner');

  await build(root, {fileReplacements});
  const replaced = (await readOutput(path.join(root, 'dist'))).map((f) => f.content).join('\n');
  // The value Vite bundles from the replaced file.
  assert.ok(/["'`]production["'`]/.test(replaced), 'bundled the production environment');
  // The banner's template, which ngp's analyzer reads from the replaced file when it compiles
  // banner.ts. Had only Vite seen the replacement, this would be the development banner.
  assert.ok(has(replaced, 'production banner') && !has(replaced, '<b>production banner</b>'), 'compiled the production banner');
  assert.ok(!has(replaced, 'development banner'), 'no development banner left');
});

test('fileReplacements: an edit to the replacement recompiles what uses it, in dev', async () => {
  const root = await copyFixture('ng-build-app', 'replacements-dev');
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    server: {middlewareMode: true, ws: false},
    plugins: ngp({toolchain, fileReplacements}),
  });
  try {
    const client = server.environments.client;
    const banner = async () => (await client.transformRequest('/src/banner.ts'))?.code ?? '';
    assert.match(await banner(), /ɵɵdefineComponent/);
    assert.match(await banner(), /production banner/);
    assert.doesNotMatch(await banner(), /development banner/);

    const replacement = path.join(root, 'src/environments/environment.prod.ts');
    const content = await fs.readFile(replacement, 'utf8');
    await fs.writeFile(replacement, content.replace('production banner', 'edited banner'));
    server.watcher.emit('change', replacement);
    // The watcher handles the change asynchronously; wait for the module to be compiled again.
    for (let i = 0; i < 50 && !(await banner()).includes('edited banner'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const text = (code) => code.match(/ɵɵtext\([^)]*\)/)?.[0];
    assert.equal(text(await banner()), 'ɵɵtext(1, "edited banner")', 'after editing the replacement');

    // An edit to the replaced file changes nothing: the replacement's content still applies.
    const replaced = path.join(root, 'src/environments/environment.ts');
    await fs.writeFile(replaced, (await fs.readFile(replaced, 'utf8')).replace('development banner', 'stale banner'));
    server.watcher.emit('change', replaced);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(text(await banner()), 'ɵɵtext(1, "edited banner")', 'after editing the replaced file');
  } finally {
    await server.close();
  }
});

test('fileReplacements: a missing replacement fails like the CLI does', async () => {
  const root = await copyFixture('ng-build-app', 'replacements-missing');
  await assert.rejects(
    build(root, {fileReplacements: [{replace: 'src/environments/environment.ts', with: 'src/environments/environment.staging.ts'}]}),
    /environment\.staging\.ts path in file replacements does not exist/,
  );
});

test('budget sizes parse and print like the CLI', () => {
  assert.equal(bytes('500kB'), 500_000);
  assert.equal(bytes('1MB'), 1_000_000);
  assert.equal(bytes('1.5 mb'), 1_500_000);
  assert.equal(bytes('300'), 300);
  assert.equal(bytes('10%', '200kB'), 220_000);
  assert.equal(bytes('10%', '200kB', -1), 180_000);
  assert.ok(Number.isNaN(bytes('lots')));
  assert.equal(formatSize(0), '0 bytes');
  assert.equal(formatSize(999), '999 bytes');
  assert.equal(formatSize(512_340), '512.34 kB');
});

test('budget failures read like the CLI', () => {
  const stats = {
    files: [
      {name: 'assets/index.js', size: 600_000, initial: true, names: ['index', 'main']},
      {name: 'assets/lazy.js', size: 50_000, initial: false, names: ['lazy']},
    ],
    componentStyles: [{label: 'src/app/card.css', size: 5_000}],
  };
  const failures = [
    ...checkBudgets(
      [
        {type: 'initial', maximumWarning: '500kB', maximumError: '1MB'},
        {type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB'},
        {type: 'bundle', name: 'lazy', minimumError: '60kB'},
        {type: 'allScript', baseline: '600kB', warning: '5%'},
      ],
      stats,
    ),
  ];
  assert.deepEqual(failures, [
    {severity: 'warning', label: 'bundle initial', message: 'bundle initial exceeded maximum budget. Budget 500.00 kB was not met by 100.00 kB with a total of 600.00 kB.'},
    {severity: 'warning', label: 'src/app/card.css', message: 'src/app/card.css exceeded maximum budget. Budget 4.00 kB was not met by 1.00 kB with a total of 5.00 kB.'},
    {severity: 'error', label: 'lazy', message: 'lazy failed to meet minimum budget. Budget 60.00 kB was not met by 10.00 kB with a total of 50.00 kB.'},
    {severity: 'warning', label: 'total scripts', message: 'total scripts exceeded maximum budget. Budget 630.00 kB was not met by 20.00 kB with a total of 650.00 kB.'},
  ]);
});

test('budgets: warnings are logged and errors fail `vite build`', async () => {
  const root = await copyFixture('ng-build-app', 'budgets');
  const {logger, messages} = recordingLogger();
  await build(
    root,
    {
      budgets: [
        {type: 'initial', maximumWarning: '10kB'},
        {type: 'bundle', name: 'main', maximumWarning: '10kB'},
        {type: 'anyComponentStyle', maximumWarning: '50b'},
      ],
    },
    {logger},
  );
  const [script] = (await fs.readdir(path.join(root, 'dist/assets'))).filter((f) => f.endsWith('.js'));
  const size = (await fs.stat(path.join(root, 'dist/assets', script))).size;
  // The fixture is one chunk, so the initial bundle is exactly the file on disk.
  assert.ok(messages.warnings.some((w) => w.includes(`bundle initial exceeded maximum budget. Budget 10.00 kB was not met by ${formatSize(size - 10_000)} with a total of ${formatSize(size)}.`)), messages.warnings.join('\n'));
  assert.ok(messages.warnings.some((w) => w.includes('main exceeded maximum budget')), messages.warnings.join('\n'));
  // The root component's inline `styles`, as written: ngp compiles them and doesn't minify.
  assert.ok(messages.warnings.some((w) => w.includes('src/app.ts (App inline style 1) exceeded maximum budget. Budget 50 bytes')), messages.warnings.join('\n'));
  // The banner's styleUrl file, as the bundle inlines it: minified, so smaller than the file.
  const bannerCss = (await fs.stat(path.join(root, 'src/banner.css'))).size;
  const banner = messages.warnings.find((w) => w.includes('src/banner.css exceeded maximum budget'));
  const measured = Number(/with a total of (\d+) bytes/.exec(banner ?? '')?.[1]);
  assert.ok(measured > 50 && measured < bannerCss / 2, `banner.css measured ${measured} bytes, the file is ${bannerCss}`);

  await assert.rejects(build(root, {budgets: [{type: 'initial', maximumError: '10kB'}]}, {logger}), /1 budget exceeded: bundle initial/);
  assert.ok(messages.errors.some((e) => e.includes('bundle initial exceeded maximum budget')));
});

test('outputPath: with ssr, both bundles go below build.outDir', async () => {
  const root = await copyFixture('ng-build-app', 'out-dir');
  await build(root, {ssr: true}, {config: {build: {outDir: 'out'}}});
  const names = async (dir) => (await readOutput(path.join(root, dir))).map((f) => f.name);
  assert.ok((await names('out/client')).includes('index.html'), 'browser bundle in out/client');
  assert.ok((await names('out/server')).includes('main.server.js'), 'server entry in out/server');
  await assert.rejects(fs.access(path.join(root, 'dist')), {code: 'ENOENT'}, 'nothing in dist');

  // An outDir set on an environment is the app's choice, and stays.
  const config = {build: {outDir: 'out'}, environments: {ssr: {build: {outDir: 'server-bundle'}}}};
  await build(root, {ssr: true}, {config});
  assert.ok((await names('server-bundle')).includes('main.server.js'), 'server entry in server-bundle');
});
