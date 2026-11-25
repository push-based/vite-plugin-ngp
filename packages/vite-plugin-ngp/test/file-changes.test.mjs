// Adding, renaming and deleting files while the dev server runs. Each test starts a Vite dev server
// on a temp copy of test/fixtures/file-changes, changes files on disk, lets Vite's own watcher
// deliver the events, and then checks what the server compiles against a fresh NgpCompiler that
// reads the app's full tsconfig. The server's analyzer reads the entry-only tsconfig (decision 4
// in docs/decisions.md), so it can only find a new file by following imports. Run `pnpm build`
// first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {NgpCompiler} from '../dist/compiler.js';
import {ngp} from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const fixture = path.join(here, 'fixtures/file-changes');
const toolchainDir = process.env.NGP_TOOLCHAIN ?? path.join(repo, 'toolchain/out');
const EVENT_TIMEOUT = 10_000;

/**
 * A dev server on a fresh copy of the fixture, plus helpers to change it and read its output.
 * `plugins` run before ngp's.
 */
async function startApp({plugins = []} = {}) {
  // realpath: on macOS the temp dir is behind a /var -> /private/var symlink, and the analyzer and
  // Vite both report real paths.
  const root = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-ngp-files-')));
  await fs.cp(fixture, root, {recursive: true});
  // The fixture has no dependencies of its own; borrow the repo's (pnpm installs them hoisted).
  await fs.symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');

  /** The code ngp handed to the next plugin, per file: what the server currently serves. */
  const compiled = new Map();
  /**
   * Files whose watcher event is still awaited. Keyed by file alone: macOS reports a new file as
   * `update` as often as `create`, so the event type can't be relied on.
   */
  const pending = new Map();
  const errors = [];

  const server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(root, '.vite'),
    logLevel: 'silent',
    customLogger: logger(errors),
    optimizeDeps: {noDiscovery: true, include: []},
    server: {ws: false},
    plugins: [
      ...plugins,
      ngp({toolchain: toolchainDir}),
      {
        name: 'test:capture',
        enforce: 'pre',
        transform(code, id) {
          compiled.set(id.replace(/[?#].*$/, ''), code);
        },
      },
      {
        name: 'test:events',
        hotUpdate: {
          order: 'post',
          handler({file}) {
            if (this.environment.name === 'client') {
              pending.get(file)?.();
            }
          },
        },
      },
    ],
  });

  // What the browser would receive over HMR, since the last change.
  const sent = [];
  const hot = server.environments.client.hot;
  const send = hot.send.bind(hot);
  hot.send = (payload, ...rest) => {
    sent.push(payload);
    return send(payload, ...rest);
  };

  const abs = (rel) => path.join(root, rel);

  /** Resolves once Vite has run every plugin's hotUpdate for a watcher event on each file. */
  function expect(files, timeout = EVENT_TIMEOUT) {
    return Promise.all(
      files.map((rel) => {
        const key = abs(rel);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no watcher event for ${key} within ${timeout} ms`)), timeout);
          pending.set(key, () => {
            clearTimeout(timer);
            pending.delete(key);
            resolve();
          });
        });
      }),
    );
  }

  /**
   * When each file was last written. Vite's watcher, chokidar 3, drops a second change to the same
   * file within 50 ms of the first, with no later event, and a fast machine gets from one step of
   * a test to the next in less than that.
   */
  const written = new Map();
  async function writeFiles(files) {
    const due = Math.max(0, ...Object.keys(files).map((rel) => (written.get(rel) ?? 0) + 60 - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, due));
    for (const [rel, content] of Object.entries(files)) {
      await fs.writeFile(abs(rel), content);
      written.set(rel, Date.now());
    }
  }

  const app = {
    root,
    server,
    errors,
    sent,
    async write(files, timeout) {
      sent.length = 0;
      const done = expect(Object.keys(files), timeout);
      await writeFiles(files);
      await done;
    },
    async remove(...files) {
      sent.length = 0;
      const done = expect(files);
      for (const rel of files) {
        await fs.rm(abs(rel));
      }
      await done;
    },
    /** Renames `from` to `to`, and writes `files` in the same change. */
    async rename(from, to, files = {}) {
      sent.length = 0;
      const done = expect([from, to, ...Object.keys(files)]);
      await fs.rename(abs(from), abs(to));
      await writeFiles(files);
      await done;
    },
    read: (rel) => fs.readFile(abs(rel), 'utf8'),
    /** What the dev server's ngp compiler produces for a file, as Vite would serve it now. */
    async served(rel) {
      await server.environments.client.transformRequest('/' + rel);
      return compiled.get(abs(rel));
    },
    /** ngp's output for a file, even when a later plugin (Vite's import analysis) fails it. */
    async compiled(rel) {
      compiled.delete(abs(rel));
      await server.environments.client.transformRequest('/' + rel).catch(() => {});
      return compiled.get(abs(rel));
    },
    async close() {
      await server.close();
      await fs.rm(root, {recursive: true, force: true});
    },
  };

  // Vite's watcher starts asynchronously, and misses changes made before it's ready.
  await waitForWatcher(app);
  return app;
}

async function waitForWatcher(app) {
  for (let i = 0; ; i++) {
    try {
      await app.write({'watcher-probe.txt': String(i)}, 1000);
      return;
    } catch (error) {
      if (i === 10) throw error;
    }
  }
}

function logger(errors) {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    warnOnce: noop,
    error: (msg) => errors.push(msg),
    clearScreen: noop,
    hasErrorLogged: () => false,
    hasWarned: false,
  };
}

/**
 * What a fresh compiler, with the app's full tsconfig and nothing cached, makes of each file on
 * disk now. That's the output the long-lived dev-server compiler has to match.
 */
async function fresh(app, files) {
  const tsconfig = path.join(app.root, 'tsconfig.json');
  const compiler = await NgpCompiler.create({toolchainDir, engine: 'native', tsconfig, analyzerTsconfig: tsconfig, enableHmr: true});
  try {
    const out = {};
    for (const rel of files) {
      const code = await app.read(rel);
      out[rel] = (await compiler.transform(path.join(app.root, rel), code))?.code ?? code;
    }
    return out;
  } finally {
    compiler.close();
  }
}

/** Asserts the dev server serves each file exactly as a fresh compiler compiles it. */
async function assertFresh(app, files) {
  const expected = await fresh(app, files);
  for (const rel of files) {
    assert.equal(await app.served(rel), expected[rel], `${rel} differs from a fresh compile`);
  }
  return expected;
}

const component = (name, selector, body) => `import {Component} from '@angular/core';

@Component({
  selector: '${selector}',
  ${body},
})
export class ${name} {}
`;

const appTs = (imports) => `import {Component} from '@angular/core';
${imports.map(([name, file]) => `import {${name}} from './${file}';`).join('\n')}

@Component({
  selector: 'app-root',
  imports: [${imports.map(([name]) => name).join(', ')}],
  templateUrl: './app.html',
})
export class App {
  title = 'file changes';
}
`;

/** Waits for the dev server to send the browser a message that matches. */
async function received(app, predicate, what) {
  for (const start = Date.now(); Date.now() - start < EVENT_TIMEOUT; ) {
    if (app.sent.some(predicate)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`the browser was never sent ${what}; got ${JSON.stringify(app.sent)}`);
}

/**
 * Waits out a template change's HMR decision, which the plugin makes in the background after
 * waiting 50 ms for the rest of the edit. For asserting that nothing was sent.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 300));

const fullReload = (payload) => payload.type === 'full-reload';
const componentUpdate = (id) => (payload) =>
  payload.type === 'custom' && payload.event === 'angular:component-update' && payload.data.id === encodeURIComponent(id);

/** Whether compiled output renders `selector` as a component: in its template and dependencies. */
function rendersComponent(code, selector, className) {
  return code.includes(`'${selector}'`) && new RegExp(`dependencies: \\[[^\\]]*\\b${className}\\b`).test(code);
}

async function withApp(fn, options) {
  const app = await startApp(options);
  try {
    await assertFresh(app, ['src/main.ts', 'src/app/app.ts', 'src/app/greeting.ts']);
    await fn(app);
    assert.deepEqual(app.errors, [], 'the dev server logged errors');
  } finally {
    await app.close();
  }
}

test('a new component, imported in the same change', () =>
  withApp(async (app) => {
    await app.write({
      'src/app/card.ts': component('Card', 'app-card', "template: '<p>Card</p>'"),
      'src/app/app.ts': appTs([['Greeting', 'greeting'], ['Card', 'card']]),
      'src/app/app.html': '<h1>{{ title }}</h1>\n<app-greeting />\n<app-card />\n',
    });
    const out = await assertFresh(app, ['src/app/app.ts', 'src/app/card.ts']);
    assert.ok(rendersComponent(out['src/app/app.ts'], 'app-card', 'Card'), 'App should render Card');
  }));

test('a new component, imported in the next change', () =>
  withApp(async (app) => {
    await app.write({'src/app/card.ts': component('Card', 'app-card', "template: '<p>Card</p>'")});
    await assertFresh(app, ['src/app/app.ts']);
    await app.write({
      'src/app/app.ts': appTs([['Greeting', 'greeting'], ['Card', 'card']]),
      'src/app/app.html': '<h1>{{ title }}</h1>\n<app-greeting />\n<app-card />\n',
    });
    const out = await assertFresh(app, ['src/app/app.ts', 'src/app/card.ts']);
    assert.ok(rendersComponent(out['src/app/app.ts'], 'app-card', 'Card'), 'App should render Card');
  }));

test('deleting a file the app no longer imports, then adding it back changed', () =>
  withApp(async (app) => {
    await app.write({
      'src/app/app.ts': appTs([]),
      'src/app/app.html': '<h1>{{ title }}</h1>\n',
    });
    await app.remove('src/app/greeting.ts');
    await assertFresh(app, ['src/main.ts', 'src/app/app.ts']);

    // Importing it again without restoring it: the analyzer must not still see the old file.
    await app.write({'src/app/app.ts': appTs([['Greeting', 'greeting']])});
    const missing = (await fresh(app, ['src/app/app.ts']))['src/app/app.ts'];
    assert.equal(await app.compiled('src/app/app.ts'), missing, 'App still compiles against the deleted file');
    await assert.rejects(app.served('src/app/app.ts'), (e) => /Failed to resolve import "\.\/greeting"/.test(e.message));
    app.errors.length = 0;

    // Nothing of the deleted file may linger: a new file at the same path compiles from its own
    // content.
    await app.write({'src/app/greeting.ts': component('Greeting', 'app-hello', "template: '<p>Hi</p>'")});
    await app.write({
      'src/app/app.ts': appTs([['Greeting', 'greeting']]),
      'src/app/app.html': '<h1>{{ title }}</h1>\n<app-hello />\n',
    });
    const out = await assertFresh(app, ['src/app/app.ts', 'src/app/greeting.ts']);
    assert.ok(rendersComponent(out['src/app/app.ts'], 'app-hello', 'Greeting'), 'App should render app-hello');
    // The type-check runs in a child process. On a loaded machine its report of the import that
    // was missing arrives after the errors were cleared above.
    const lateTypeCheck = /type-check: [\s\S]*TS2307: Cannot find module '\.\/greeting'/;
    app.errors.splice(0, app.errors.length, ...app.errors.filter((error) => !lateTypeCheck.test(error)));
  }));

test('renaming a file and updating its import', () =>
  withApp(async (app) => {
    await app.rename('src/app/greeting.ts', 'src/app/hello.ts', {
      'src/app/app.ts': appTs([['Greeting', 'hello']]),
    });
    const out = await assertFresh(app, ['src/main.ts', 'src/app/app.ts', 'src/app/hello.ts']);
    assert.ok(rendersComponent(out['src/app/app.ts'], 'app-greeting', 'Greeting'), 'App should still render Greeting');
    await assert.rejects(app.served('src/app/greeting.ts'));
  }));

test('deleting a file that is still imported fails clearly, and restoring it recovers', () =>
  withApp(async (app) => {
    const greeting = await app.read('src/app/greeting.ts');
    await app.remove('src/app/greeting.ts');
    await received(app, fullReload, 'a reload');
    // ngp reports the template's use of the missing component; Vite's import analysis, which
    // runs after it, would report the import.
    await assert.rejects(app.served('src/app/app.ts'), (e) => /'app-greeting' is not a known element/.test(e.message));

    await app.write({'src/app/greeting.ts': greeting});
    await received(app, fullReload, 'a reload');
    const out = await assertFresh(app, ['src/main.ts', 'src/app/app.ts', 'src/app/greeting.ts']);
    assert.ok(rendersComponent(out['src/app/app.ts'], 'app-greeting', 'Greeting'), 'App should render Greeting again');
    app.errors.length = 0;
  }));

test('a new external template, in the same change as its templateUrl', () =>
  withApp(async (app) => {
    await app.write({
      'src/app/greeting.html': '<p>Hello from a template</p>\n',
      'src/app/greeting.ts': component('Greeting', 'app-greeting', "templateUrl: './greeting.html'"),
    });
    const out = await assertFresh(app, ['src/app/greeting.ts']);
    assert.match(out['src/app/greeting.ts'], /Hello from a template/);
  }));

test('changing templateUrl to a new file, then editing both templates', () =>
  withApp(async (app) => {
    // First the templateUrl points at a file that doesn't exist yet, so the reloaded page fails.
    await app.write({'src/app/app.ts': appTs([['Greeting', 'greeting']]).replace('./app.html', './main.html')});
    await received(app, fullReload, 'a reload');
    await assert.rejects(app.served('src/app/app.ts'), (e) => /Could not find template file '\.\/main\.html'/.test(e.message));
    await app.write({'src/app/main.html': '<h2>{{ title }}</h2>\n<app-greeting />\n'});
    await received(app, fullReload, 'a reload');
    let out = await assertFresh(app, ['src/app/app.ts']);
    assert.match(out['src/app/app.ts'], /'h2'/);

    // The old template no longer belongs to App.
    await app.write({'src/app/app.html': '<h3>old</h3>\n'});
    await settled();
    assert.ok(!app.sent.some(componentUpdate('src/app/app.ts@App')), 'the old template still updates App');
    // The new one updates it in place.
    await app.write({'src/app/main.html': '<h4>{{ title }}</h4>\n<app-greeting />\n'});
    await received(app, componentUpdate('src/app/app.ts@App'), 'an HMR update for App');
    out = await assertFresh(app, ['src/app/app.ts']);
    assert.match(out['src/app/app.ts'], /'h4'/);
    app.errors.length = 0;
  }));

test('deleting an external template that is still used fails clearly, and restoring it recovers', () =>
  withApp(async (app) => {
    const template = await app.read('src/app/app.html');
    await app.remove('src/app/app.html');
    await received(app, fullReload, 'a reload');
    await assert.rejects(app.served('src/app/app.ts'), (e) => /Could not find template file '\.\/app\.html'/.test(e.message));

    // App never loaded in the browser, so there's nothing to update in place.
    await app.write({'src/app/app.html': template});
    await received(app, fullReload, 'a reload');
    assert.ok(!app.sent.some(componentUpdate('src/app/app.ts@App')), 'expected a reload, not an HMR update');
    await assertFresh(app, ['src/app/app.ts']);
    app.errors.length = 0;
  }));

test('a transform that read a file before an edit leaves the edit in place', async () => {
  // Holds one transform of `text.ts` after Vite has read the file and before ngp sees the code, the
  // way a pre-transform can still be running when the file changes.
  let gate = null;
  const holdNextTransform = () => {
    let reached, release;
    const held = new Promise((resolve) => (reached = resolve));
    gate = {reached, released: new Promise((resolve) => (release = resolve))};
    return {held, release};
  };
  const gatePlugin = {
    name: 'test:gate',
    enforce: 'pre',
    async transform(code, id) {
      if (gate && id.endsWith('/src/app/text.ts')) {
        const {reached, released} = gate;
        gate = null;
        reached(code);
        await released;
      }
    },
  };
  await withApp(
    async (app) => {
      await app.write({
        'src/app/text.ts': "export const TEXT = '<p>before</p>';\n",
        'src/app/greeting.ts': component('Greeting', 'app-greeting', "template: TEXT").replace(
          "import {Component} from '@angular/core';",
          "import {Component} from '@angular/core';\nimport {TEXT} from './text';",
        ),
      });
      assert.match(await app.served('src/app/greeting.ts'), /before/);

      const {held, release} = holdNextTransform();
      const transform = app.server.environments.client.transformRequest('/src/app/text.ts').catch(() => {});
      assert.match(await held, /before/, 'the held transform read the file before the edit');
      await app.write({'src/app/text.ts': "export const TEXT = '<p>after</p>';\n"});
      release();
      await transform;

      // Greeting first: compiling text.ts again would mend the analyzer.
      const out = await assertFresh(app, ['src/app/greeting.ts']);
      assert.match(out['src/app/greeting.ts'], /after/);
      // Vite drops the held result, since the edit invalidated the module while it ran.
      assert.match(await app.served('src/app/text.ts'), /after/);
    },
    {plugins: [gatePlugin]},
  );
});
