// `ssr` with `@angular/ssr`: an app laid out like `ng new --ssr` renders through
// AngularNodeAppEngine in the dev server and from the built server.js, with render modes, status
// codes, redirects and prerendered pages. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'vite';
import {ngp} from '../dist/index.js';
import {build, copyFixture, toolchain} from './fixture.mjs';

/** What a page says: its render context and the route's text, or null. */
async function page(base, route, accept = 'text/html') {
  const response = await fetch(new URL(route, base), {headers: {accept}, redirect: 'manual'});
  const body = await response.text();
  return {
    status: response.status,
    location: response.headers.get('location'),
    context: /ng-server-context="([^"]*)"/.exec(body)?.[1] ?? null,
    text: /id="page">([^<]*)</.exec(body)?.[1] ?? null,
    body,
  };
}

/**
 * The event dispatch contract, ahead of everything in the body but Angular's hydration marker,
 * then the call that starts queueing clicks.
 */
const EVENT_REPLAY =
  /<body[^>]*><!--nghm--><script type="text\/javascript" id="ng-event-dispatch-contract">[\s\S]+?<\/script><script>window\.__jsaction_bootstrap\(document\.body,"ng",\["click"\],\[\]\);<\/script>/;

/** Every route of the fixture, as the CLI's engine answers it. */
async function assertRoutes(base) {
  const home = await page(base, '/');
  assert.deepEqual({status: home.status, context: home.context, text: home.text}, {status: 200, context: 'ssg', text: 'home'});
  assert.match(home.body, EVENT_REPLAY, 'a prerendered page with a listener replays events');
  const about = await page(base, '/about');
  assert.deepEqual({status: about.status, context: about.context, text: about.text}, {status: 200, context: 'ssg', text: 'about'});
  assert.doesNotMatch(about.body, /ng-event-dispatch-contract/, 'a page with nothing to replay has no contract script');
  const user = await page(base, '/user/42');
  assert.deepEqual({status: user.status, context: user.context, text: user.text}, {status: 200, context: 'ssr', text: 'user 42'});
  assert.match(user.body, EVENT_REPLAY, 'a page rendered on request replays events');
  const client = await page(base, '/client');
  assert.equal(client.status, 200);
  assert.equal(client.text, null, 'a Client route is not rendered on the server');
  assert.match(client.body, /<app-root><\/app-root>/);
  assert.doesNotMatch(client.body, /ng-event-dispatch-contract/, 'a Client route has no contract script');
  const old = await page(base, '/old');
  assert.equal(old.status, 301);
  assert.match(old.location, /\/about$/);
  assert.deepEqual(await page(base, '/nope').then(({status, text}) => ({status, text})), {status: 404, text: 'not found'});
}

/** Starts a dev server on a free port and resolves to its URL. */
async function devServer(root, label) {
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    server: {port: 0, host: '127.0.0.1', ws: false},
    plugins: ngp({toolchain, ssr: true, typeCheck: false}),
  });
  await server.listen();
  const {port} = server.httpServer.address();
  return {server, base: `http://127.0.0.1:${port}/`, label};
}

test('the dev server renders through server.ts, with every render mode, and after an edit', async () => {
  const root = await copyFixture('angular-ssr-app', 'angular-ssr-dev');
  const {server, base} = await devServer(root);
  try {
    await assertRoutes(base);
    const home = await page(base, '/');
    assert.match(home.body, /@vite\/client/, 'the page is index.html as Vite transformed it');
    const ping = await fetch(new URL('/api/ping', base), {headers: {accept: 'application/json'}});
    assert.deepEqual(await ping.json(), {pong: true}, "server.ts's own routes answer in dev");

    const routes = path.join(root, 'src/app/app.routes.ts');
    await fs.writeFile(routes, (await fs.readFile(routes, 'utf8')).replace('>about<', '>about, edited<'));
    let text = null;
    for (let i = 0; i < 40 && text !== 'about, edited'; i++) {
      await delay(100);
      text = (await page(base, '/about')).text;
    }
    assert.equal(text, 'about, edited', 'the next render shows the edit');
  } finally {
    await server.close();
  }
});

test('without server.ts, the dev server renders pages with the server app directly', async () => {
  const root = await copyFixture('angular-ssr-app', 'angular-ssr-dev-no-server');
  await fs.rm(path.join(root, 'src/server.ts'));
  const {server, base} = await devServer(root);
  try {
    await assertRoutes(base);
  } finally {
    await server.close();
  }
});

test('vite build prerenders, writes the manifests, and server.js serves every route', async () => {
  const root = await copyFixture('angular-ssr-app', 'angular-ssr-build');
  await build(root, {ssr: true});
  const dist = path.join(root, 'dist');
  for (const file of ['server/main.server.js', 'server/server.js', 'server/angular-app-manifest.mjs', 'server/angular-app-engine-manifest.mjs']) {
    await fs.access(path.join(dist, file));
  }
  const about = await fs.readFile(path.join(dist, 'client/about/index.html'), 'utf8');
  assert.match(about, /ng-server-context="ssg"/);
  assert.match(await fs.readFile(path.join(dist, 'client/index.html'), 'utf8'), EVENT_REPLAY, 'the prerendered file replays events');
  const template = (name) => fs.readFile(path.join(dist, 'server/assets-chunks', name), 'utf8');
  assert.match(await template('index_server_html.mjs'), /ng-event-dispatch-contract/, 'Angular renders into a document with the contract');
  assert.doesNotMatch(await template('index_csr_html.mjs'), /ng-event-dispatch-contract/, "the browser's own document has none");
  const manifest = await fs.readFile(path.join(dist, 'server/angular-app-manifest.mjs'), 'utf8');
  assert.match(manifest, /"about\/index\.html": \{/, 'the prerendered page is a server asset');
  assert.match(manifest, /routes: \[/, 'the route tree is in the manifest, so the server needs no extraction');
  const engine = await fs.readFile(path.join(dist, 'server/angular-app-engine-manifest.mjs'), 'utf8');
  assert.match(engine, /allowedHosts: \["localhost"\]/);

  // A port the OS picks, given to server.js the way a host gives it: PORT.
  const port = await new Promise((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, [path.join(dist, 'server/server.js')], {env: {...process.env, PORT: String(port)}, stdio: 'pipe'});
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  try {
    const base = `http://localhost:${port}/`;
    for (let i = 0; i < 100 && !output.includes(String(port)); i++) {
      await delay(50);
    }
    assert.match(output, new RegExp(String(port)), `server.js didn't start:\n${output}`);
    await assertRoutes(base);
    const ping = await fetch(new URL('/api/ping', base));
    assert.deepEqual(await ping.json(), {pong: true});
    const other = await page(`http://127.0.0.1:${port}/`, '/user/1');
    assert.equal(other.status, 400, 'a host outside allowedHosts is refused');
  } finally {
    child.kill();
  }
});

test('with zone.js, both server entries load zone.js/node before anything else', async () => {
  const root = await copyFixture('angular-ssr-app', 'angular-ssr-zone');
  await build(root, {ssr: true, polyfills: ['zone.js'], typeCheck: false});
  for (const entry of ['main.server.js', 'server.js']) {
    const code = await fs.readFile(path.join(root, 'dist/server', entry), 'utf8');
    const first = /^import[^;]*;/m.exec(code)?.[0];
    assert.match(first, /^import ['"]zone\.js\/node['"];$/, entry);
  }
});

test('i18n with @angular/ssr fails with a message', async () => {
  const root = await copyFixture('angular-ssr-app', 'angular-ssr-i18n');
  await assert.rejects(build(root, {ssr: true, i18n: {sourceLocale: 'en-US'}}), /i18n with @angular\/ssr is not supported yet/);
});
