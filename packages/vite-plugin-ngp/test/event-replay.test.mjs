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
import {createBuilder, createServer} from 'vite';
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
    const html = await response.text();
    assert.equal(response.status, 200, html);
    return html;
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
  const page = (body, head = '<title>t</title>') => `<!doctype html><html><head>${head}</head>${body}</html>`;
  const add = (html, nonce) => addEventDispatchContract(html, root, nonce);
  assert.match(add(page('<body class="a > b"><app-root></app-root></body>')), new RegExp(`<body class="a > b">${CONTRACT.source}<app-root>`));
  assert.match(add(page(`<body data-note=it's><app-root></app-root></body>`)), new RegExp(`<body data-note=it's>${CONTRACT.source}<app-root>`), 'a tag with a stray quote');

  // A `<body>` that isn't the tag: in a title, a comment, or a script's string.
  for (const head of ['<title>The <body> tag</title>', '<!-- <body> -->', '<script>const tag = "<body>";</script>', '<style>/* <body> */</style>']) {
    const html = add(page('<body><app-root></app-root></body>', head));
    assert.ok(html.includes(head), `${head} is left as it is`);
    assert.match(html, new RegExp(`</head><body>${CONTRACT.source}<app-root>`), head);
  }

  const nonce = (html) => /id="ng-event-dispatch-contract"( nonce="[^"]*")?>/.exec(html)?.[1] ?? null;
  assert.equal(nonce(add(page('<body><app-root ngCspNonce="abc"></app-root></body>'), 'vite')), ' nonce="abc"', 'ngCspNonce is the nonce, as in the CLI');
  assert.equal(nonce(add(page('<body><app-root ngCspNonce="a&amp;b"></app-root></body>'))), ' nonce="a&amp;b"', 'copied as written, not escaped twice');
  assert.equal(nonce(add(page(`<body><app-root ngCspNonce='a"b'></app-root></body>`))), ' nonce="a&quot;b"');
  assert.equal(nonce(add(page('<body></body>'), 'a"b&c')), ' nonce="a&quot;b&amp;c"', "else Vite's html.cspNonce");
  assert.equal(nonce(add(page('<body><app-root ngCspNonce=""></app-root></body>'), 'vite')), ' nonce="vite"', 'an empty ngCspNonce is no nonce');
  assert.equal(nonce(add(page('<body></body>', '<!-- put ngCspNonce="x" on the root -->'))), null, 'ngCspNonce in a comment is no nonce');
  assert.equal(nonce(add(page('<body></body>'))), null);

  const once = add(page('<body></body>'));
  assert.equal(add(once), once, 'a document that has the script is left alone');
  assert.equal(add('<app-root></app-root>'), '<app-root></app-root>', 'no <body> tag, no script');
  // From the filesystem's root, no @angular/core resolves.
  const nowhere = path.parse(root).root;
  assert.equal(addEventDispatchContract(page('<body></body>'), nowhere), page('<body></body>'), 'no @angular/core to read it from, no script');
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

  // The browser build writes it too, so a rebuild of that bundle alone can't leave it stale.
  await fs.rm(template);
  const builder = await createBuilder({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    plugins: ngp({toolchain, ssr: true, typeCheck: false}),
  });
  await builder.build(builder.environments.client);
  const rebuilt = await fs.readFile(template, 'utf8');
  assert.equal(rebuilt.replace(CONTRACT, ''), await fs.readFile(path.join(root, 'dist/client/index.html'), 'utf8'));
  assert.match(rebuilt, CONTRACT);

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
