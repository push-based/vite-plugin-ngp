// Component HMR in a real Vite dev server: what the plugin sends to the browser after an edit.
// A template-only edit updates in place. A template edited together with its component's class
// reloads once, with no update first (decision 22 in docs/decisions.md). A .ts edit that only
// changes inline styles updates in place, alone or with its template (decision 23). Run `pnpm build` first;
// needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

// The plugin's debug log is how the suite sees how long an update waited: the batch-window test
// below reads it. Set before the plugin is loaded, which reads it once.
process.env.DEBUG = [process.env.DEBUG, 'vite-plugin-ngp'].filter(Boolean).join(',');
const {ngp} = await import('../dist/index.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const toolchain = process.env.NGP_TOOLCHAIN ?? path.join(repo, 'toolchain/out');

/** Longer than the plugin's 50 ms batch window, with room for the analyzer. */
const SETTLE_MS = 400;

const COMPONENT = (field, color) => `import {Component, signal} from '@angular/core';

@Component({selector: 'app-root', templateUrl: './app.html'${color ? `, styles: 'p { color: ${color}; }'` : ''}})
export class App {
  protected readonly ${field} = signal(1);
}
`;
const TEMPLATE = (field, text = 'Count') => `<p>${text}: {{ ${field}() }}</p>\n`;

let root;
let server;
/** Everything the plugin and Vite sent over the client's HMR channel. */
let sent = [];
/** The plugin's debug log: one line per compile, and one per template update with its timings. */
const logged = [];
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  if (String(chunk).startsWith('vite-plugin-ngp ')) {
    logged.push(String(chunk));
    return true;
  }
  return stderrWrite(chunk, ...rest);
};

before(async () => {
  // Inside the repo, so Angular resolves from the root node_modules.
  root = await fs.mkdtemp(path.join(here, '.hmr-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {strict: true, target: 'ES2022', module: 'preserve', experimentalDecorators: true, skipLibCheck: true},
      include: ['src/**/*.ts'],
    }),
  );
  await fs.writeFile(
    path.join(root, 'src/main.ts'),
    "import {bootstrapApplication} from '@angular/platform-browser';\nimport {App} from './app';\n\nbootstrapApplication(App);\n",
  );
  await fs.writeFile(path.join(root, 'src/app.ts'), COMPONENT('count'));
  await fs.writeFile(path.join(root, 'src/app.html'), TEMPLATE('count'));

  server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    // No type-check: nothing here looks at it, and it would run tsgo on every core 300 ms after
    // each edit, next to the watcher and the timings this suite checks.
    plugins: [ngp({toolchain, typeCheck: false})],
    server: {middlewareMode: true, ws: false},
  });
  // Edits made before the watcher has seen the files would go unreported.
  await until(() => server.watcher.getWatched()[path.join(root, 'src')]?.includes('app.html'));
  const hot = server.environments.client.hot;
  const send = hot.send.bind(hot);
  hot.send = (payload, ...rest) => {
    sent.push(payload);
    return send(payload, ...rest);
  };
  // Puts the component in the client's module graph, as a page load would.
  await server.environments.client.transformRequest('/src/app.ts');
});

after(async () => {
  process.stderr.write = stderrWrite;
  await server?.close();
  if (root) {
    await fs.rm(root, {recursive: true, force: true});
  }
});

const updates = () => sent.filter((p) => p.type === 'custom' && p.event === 'angular:component-update');
const reloads = () => sent.filter((p) => p.type === 'full-reload');
/** How long the plugin's last template update waited for the rest of its save, from its log. */
function lastWait() {
  const line = logged.findLast((l) => l.startsWith('vite-plugin-ngp hmr '));
  const wait = /\bwait ([\d.]+)/.exec(line ?? '')?.[1];
  assert.ok(wait, `no template update timings in the plugin's log:\n${logged.join('')}`);
  return Number(wait);
}

async function until(condition) {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Long enough for anything else an edit would send. */
function pause() {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

/** Waits for `condition`, then long enough for anything else the edit would send. */
async function settle(condition) {
  await until(condition);
  await pause();
}

/** The update module the plugin serves for a component, as the browser would fetch it. */
function served(id) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let onClose = null;
    // The plugin listens for the response's close event, to know when the server is idle.
    const res = {
      getHeader: (name) => headers[name],
      setHeader: (name, value) => (headers[name] = value),
      once: (_event, listener) => (onClose = listener),
      end: (body) => {
        resolve(body);
        onClose?.();
      },
    };
    const req = {url: `/src/@ng/component?c=${id}`, method: 'GET', headers: {}};
    server.middlewares.handle(req, res, (error) => reject(error ?? new Error(`${req.url} wasn't served`)));
  });
}

async function write(file, content) {
  await fs.writeFile(path.join(root, 'src', file), content);
}

test('a template-only edit updates the component in place', async () => {
  sent = [];
  await write('app.html', TEMPLATE('count', 'Total'));
  await settle(() => updates().length > 0);
  assert.deepEqual(updates().map((p) => decodeURIComponent(p.data.id)), ['src/app.ts@App']);
  assert.equal(reloads().length, 0);
});

test('a template written just before its class reloads once, with no update', async () => {
  sent = [];
  // One save: both files are on disk before the watcher reports either. Without the hold, a busy
  // thread pool can land the second write more than 50 ms after the first, which the plugin
  // rightly treats as two edits.
  const release = holdReports('app.html');
  try {
    await write('app.html', TEMPLATE('total'));
    await write('app.ts', COMPONENT('total'));
  } finally {
    release();
  }
  await settle(() => reloads().length > 0);
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});

test('a template written just after its class reloads once, with no update', async () => {
  // The page reloaded in the previous test, so the component is back in the module graph.
  await server.environments.client.transformRequest('/src/app.ts');
  sent = [];
  await write('app.ts', COMPONENT('count'));
  await write('app.html', TEMPLATE('count'));
  await settle(() => reloads().length > 0);
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});

test('an inline styles edit in the class updates the component in place', async () => {
  // The page reloaded in the previous test, so the component is back in the module graph.
  await server.environments.client.transformRequest('/src/app.ts');
  sent = [];
  await write('app.ts', COMPONENT('count', 'red'));
  await settle(() => updates().length > 0);
  assert.deepEqual(updates().map((p) => decodeURIComponent(p.data.id)), ['src/app.ts@App']);
  assert.equal(reloads().length, 0);
  assert.match(await served(updates()[0].data.id), /color: red/);
});

for (const [order, files] of [
  ['before', ['app.ts', 'app.html']],
  ['after', ['app.html', 'app.ts']],
]) {
  test(`a template written ${order === 'before' ? 'after' : 'before'} an inline styles edit updates both in place`, async () => {
    sent = [];
    const color = order === 'before' ? 'blue' : 'green';
    const text = order === 'before' ? 'Sum' : 'Amount';
    const contents = {'app.ts': COMPONENT('count', color), 'app.html': TEMPLATE('count', text)};
    for (const file of files) {
      await write(file, contents[file]);
    }
    // The .ts update can go out before the analyzer has the template, so the last one counts.
    await settle(() => updates().length > 0);
    assert.equal(reloads().length, 0);
    assert.ok(updates().every((p) => decodeURIComponent(p.data.id) === 'src/app.ts@App'));
    const code = await served(updates().at(-1).data.id);
    assert.match(code, new RegExp(`color: ${color}`));
    assert.match(code, new RegExp(text));
  });
}

test('a class edit outside the decorator reloads, with no update', async () => {
  sent = [];
  await write('app.ts', COMPONENT('count', 'green').replace('signal(1)', 'signal(2)'));
  await settle(() => reloads().length > 0);
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});

// The watcher doesn't report one save's files in order, or each write once. FSEvents on macOS
// reports some writes twice, and can report two files of one save about 100 ms apart. These
// tests delay and repeat reports on purpose, so they fail the same way on every platform.

/**
 * Delays the watcher's change reports for `file` by `ms`, or drops them when `ms` is null, until
 * the returned function runs.
 */
function delayReports(file, ms) {
  const watcher = server.watcher;
  const emit = watcher.emit;
  watcher.emit = function (event, changed, ...rest) {
    if (path.basename(changed ?? '') === file && (event === 'change' || event === 'all')) {
      if (ms !== null) {
        setTimeout(() => emit.call(this, event, changed, ...rest), ms);
      }
      return true;
    }
    return emit.call(this, event, changed, ...rest);
  };
  return () => (watcher.emit = emit);
}

/** Holds the watcher's change reports for `file` until the returned function sends them. */
function holdReports(file) {
  const watcher = server.watcher;
  const emit = watcher.emit;
  const held = [];
  watcher.emit = function (event, changed, ...rest) {
    if (path.basename(changed ?? '') === file && (event === 'change' || event === 'all')) {
      held.push([event, changed, ...rest]);
      return true;
    }
    return emit.call(this, event, changed, ...rest);
  };
  return () => {
    watcher.emit = emit;
    for (const args of held) {
      emit.apply(watcher, args);
    }
  };
}

function reportAgain(file) {
  server.watcher.emit('change', path.join(root, 'src', file));
}

test('a template reported twice sends one update', async () => {
  await server.environments.client.transformRequest('/src/app.ts');
  sent = [];
  await write('app.html', TEMPLATE('count', 'Twice'));
  await settle(() => updates().length > 0);
  reportAgain('app.html');
  await pause();
  assert.equal(updates().length, 1);
  assert.equal(reloads().length, 0);
});

test('a template reported after the batch window sends its update without waiting again', async () => {
  sent = [];
  const restore = delayReports('app.html', 100);
  try {
    await write('app.html', TEMPLATE('count', 'Late'));
    await settle(() => updates().length > 0);
  } finally {
    restore();
  }
  assert.equal(updates().length, 1);
  // The window is 50 ms from the write, and the report came at least 100 ms after it, so there was
  // nothing left to wait for. The plugin's own timing says whether it waited; the time from the
  // report to the event can't, because on two slow cores the work in between alone took 37 ms.
  const wait = lastWait();
  assert.ok(wait < 25, `waited ${wait} ms after a report that came after the window`);
});

test('a template reported before a late class change sends no update', async () => {
  sent = [];
  const restore = delayReports('app.ts', 200);
  try {
    // One save, as above: the template's report must not go out before the class is on disk.
    const release = holdReports('app.html');
    try {
      await write('app.html', TEMPLATE('total'));
      await write('app.ts', COMPONENT('total', 'green'));
    } finally {
      release();
    }
    await settle(() => reloads().length > 0);
  } finally {
    restore();
  }
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});

test('a class change reported again with its template sends no update', async () => {
  // The page reloaded in the previous test, but hasn't loaded the component again yet.
  sent = [];
  await write('app.ts', COMPONENT('count', 'green'));
  await settle(() => reloads().length > 0);
  reportAgain('app.ts');
  await write('app.html', TEMPLATE('count'));
  await pause();
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});

test('a template edited after the page loaded the changed class updates in place', async () => {
  await server.environments.client.transformRequest('/src/app.ts');
  sent = [];
  await write('app.html', TEMPLATE('count', 'Loaded'));
  await settle(() => updates().length > 0);
  assert.equal(updates().length, 1);
  assert.equal(reloads().length, 0);
});

test('a template whose class changed without a report reloads, with no update', async () => {
  sent = [];
  const restore = delayReports('app.ts', null);
  try {
    await write('app.ts', COMPONENT('total', 'green'));
    await write('app.html', TEMPLATE('total'));
    await settle(() => reloads().length > 0);
  } finally {
    restore();
  }
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});

test('a class change reported between the save truncating it and writing it reloads once', async () => {
  await server.environments.client.transformRequest('/src/app.ts');
  sent = [];
  const emit = server.watcher.emit;
  const restore = delayReports('app.ts', null);
  try {
    // A save truncates the file, then writes it. Report the change in between, as a watcher can
    // when the thread pool is busy.
    const file = path.join(root, 'src/app.ts');
    await fs.truncate(file);
    emit.call(server.watcher, 'change', file);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Written on this thread, so it lands 20 ms after the report, inside the 100 ms the plugin
    // waits for it. Through the thread pool, two slow cores let it land later than that once in
    // 20 runs, and the plugin then rightly reloaded twice.
    writeFileSync(file, COMPONENT('renamed', 'green'));
    await write('app.html', TEMPLATE('renamed'));
    await settle(() => reloads().length > 0);
    // A plugin that recorded the empty file waits a second for a report that never comes, then
    // reloads again.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    restore();
  }
  assert.equal(updates().length, 0);
  assert.equal(reloads().length, 1);
});
