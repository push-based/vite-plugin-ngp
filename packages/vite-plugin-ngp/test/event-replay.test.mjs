// Event replay (`withEventReplay()`) with a `render(url, document)` server entry: the document the
// server renders into holds Angular's event dispatch contract, in the dev server and in
// `index.server.html` of a build, and the browser's index.html doesn't. `@angular/ssr` is covered
// in angular-ssr.test.mjs. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {createServer} from 'vite';
import {addEventDispatchContract} from '../dist/event-dispatch.js';
import {ngp} from '../dist/index.js';
import {build, copyFixture, toolchain} from './fixture.mjs';

const CONTRACT = /<script type="text\/javascript" id="ng-event-dispatch-contract">[\s\S]+?<\/script>/;
/**
 * The contract, ahead of everything in the body but Angular's hydration marker, then the call
 * that starts queueing clicks.
 */
const EVENT_REPLAY = new RegExp(
  `<body[^>]*><!--nghm-->${CONTRACT.source}<script>window\\.__jsaction_bootstrap\\(document\\.body,"ng",\\["click"\\],\\[\\]\\);</script>`,
);

/**
 * A copy of the fixture with one listener, and hydration with event replay unless `replay` is
 * false. Zoneless either way, so the tests need no zone.js.
 */
async function fixture(label, replay = true) {
  const root = await copyFixture('ng-build-app', label);
  await fs.writeFile(
    path.join(root, 'src/app.config.ts'),
    [
      `import type {ApplicationConfig} from '@angular/core';`,
      `import {provideClientHydration, withEventReplay} from '@angular/platform-browser';`,
      `export const appConfig: ApplicationConfig = {providers: [${replay ? 'provideClientHydration(withEventReplay())' : ''}]};`,
    ].join('\n'),
  );
  const app = path.join(root, 'src/app.ts');
  await fs.writeFile(app, (await fs.readFile(app, 'utf8')).replace('<app-banner />', `<app-banner /><button (click)="status = 'clicked'">go</button>`));
  return root;
}

/** The dev server's page for `/`. */
async function devPage(root) {
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    server: {port: 0, host: '127.0.0.1', ws: false},
    plugins: ngp({toolchain, ssr: true, typeCheck: false}),
  });
  try {
    await server.listen();
    const {port} = server.httpServer.address();
    const response = await fetch(`http://127.0.0.1:${port}/`, {headers: {accept: 'text/html'}});
    assert.equal(response.status, 200);
    return await response.text();
  } finally {
    await server.close();
  }
}

/** Renders `/` with a built server entry into `template`, in a process of its own. */
async function renderBuilt(entry, template) {
  const script = `const {default: render} = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const {readFileSync} = await import('node:fs');
    process.stdout.write(await render('/', readFileSync(${JSON.stringify(template)}, 'utf8')));
    process.exit(0);`;
  const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
  return stdout;
}

test('the contract script goes right after <body>, with the page nonce', () => {
  const root = path.resolve(import.meta.dirname, 'fixtures/ng-build-app');
  const page = (body) => `<!doctype html><html><head><title>t</title></head>${body}</html>`;
  assert.match(addEventDispatchContract(page('<body class="a > b"><app-root></app-root></body>'), root), new RegExp(`<body class="a > b">${CONTRACT.source}<app-root>`));
  assert.match(
    addEventDispatchContract(page('<body><app-root ngCspNonce="abc"></app-root></body>'), root, 'vite'),
    /<body><script type="text\/javascript" id="ng-event-dispatch-contract" nonce="abc">/,
    'ngCspNonce is the nonce, as in the CLI',
  );
  assert.match(
    addEventDispatchContract(page('<body></body>'), root, 'a"b'),
    /id="ng-event-dispatch-contract" nonce="a&quot;b">/,
    "else Vite's html.cspNonce",
  );
  const once = addEventDispatchContract(page('<body></body>'), root);
  assert.equal(addEventDispatchContract(once, root), once, 'a document that has the script is left alone');
  assert.equal(addEventDispatchContract('<app-root></app-root>', root), '<app-root></app-root>', 'no <body> tag, no script');
  const elsewhere = path.resolve(import.meta.dirname, '../../../..');
  assert.equal(addEventDispatchContract(page('<body></body>'), elsewhere), page('<body></body>'), 'no @angular/core to read it from, no script');
});

test('dev: a page with a listener gets the contract and the bootstrap call', async () => {
  const html = await devPage(await fixture('event-replay-dev'));
  assert.match(html, EVENT_REPLAY);
  assert.match(html, /@vite\/client/, 'the page is index.html as Vite transformed it');
});

test('dev: without hydration, Angular takes the contract out again', async () => {
  const html = await devPage(await fixture('event-replay-dev-off', false));
  assert.match(html, /id="status">/, 'the page is rendered on the server');
  assert.doesNotMatch(html, /ng-event-dispatch-contract/);
});

test('build: index.server.html has the contract, and the browser index.html does not', async () => {
  const root = await fixture('event-replay-build');
  await build(root, {ssr: true, typeCheck: false});
  const client = await fs.readFile(path.join(root, 'dist/client/index.html'), 'utf8');
  const template = path.join(root, 'dist/server/index.server.html');
  const server = await fs.readFile(template, 'utf8');
  assert.doesNotMatch(client, /ng-event-dispatch-contract/);
  assert.match(server, new RegExp(`<body>${CONTRACT.source}`));
  assert.equal(server.replace(CONTRACT, ''), client, 'and is the browser index.html otherwise');

  const entry = path.join(root, 'dist/server/main.server.js');
  assert.match(await renderBuilt(entry, template), EVENT_REPLAY, 'rendered into it, the page replays events');
  assert.doesNotMatch(await renderBuilt(entry, path.join(root, 'dist/client/index.html')), /__jsaction_bootstrap/, 'rendered into the browser index.html, it cannot');
});

test('build: with i18n, each locale gets its own index.server.html', async () => {
  const root = await fixture('event-replay-i18n');
  await build(root, {ssr: true, typeCheck: false, i18n: {sourceLocale: {code: 'en-US', subPath: 'en'}}});
  const client = await fs.readFile(path.join(root, 'dist/client/en/index.html'), 'utf8');
  const server = await fs.readFile(path.join(root, 'dist/server/en/index.server.html'), 'utf8');
  assert.match(server, /<base href="\/en\/">/);
  assert.equal(server.replace(CONTRACT, ''), client);
  assert.notEqual(server, client);
  await assert.rejects(fs.access(path.join(root, 'dist/server/index.server.html')), {code: 'ENOENT'}, 'none at the root, which has no index.html');
});
