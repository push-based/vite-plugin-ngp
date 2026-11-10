// Template HMR for a component outside the folder that holds the app's tsconfig, as a library in
// a monorepo is (apps/landing next to libs/ui). The compiled component listens for an id built
// from its absolute path there, so the update the plugin sends has to carry the same id. Run
// `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

import {ngp} from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const toolchain = process.env.NGP_TOOLCHAIN ?? path.join(repo, 'toolchain/out');

let workspace;
let root;
let button;
let server;
let sent = [];

async function until(condition) {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

before(async () => {
  // Inside the repo, so Angular resolves from the root node_modules.
  workspace = await fs.mkdtemp(path.join(here, '.hmr-outside-'));
  root = path.join(workspace, 'apps/landing');
  const lib = path.join(workspace, 'libs/ui/src');
  button = path.join(lib, 'button.ts');
  await fs.mkdir(path.join(root, 'src'), {recursive: true});
  await fs.mkdir(lib, {recursive: true});
  await fs.writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {strict: true, target: 'ES2022', module: 'preserve', experimentalDecorators: true, skipLibCheck: true},
      include: ['src/**/*.ts'],
    }),
  );
  await fs.writeFile(
    path.join(root, 'src/main.ts'),
    "import {bootstrapApplication} from '@angular/platform-browser';\nimport {Button} from '../../../libs/ui/src/button';\n\nbootstrapApplication(Button);\n",
  );
  await fs.writeFile(
    button,
    "import {Component} from '@angular/core';\n\n@Component({selector: 'ui-button', templateUrl: './button.html'})\nexport class Button {}\n",
  );
  await fs.writeFile(path.join(lib, 'button.html'), '<span>before</span>\n');

  server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    plugins: [ngp({toolchain, typeCheck: false})],
    server: {middlewareMode: true, ws: false},
  });
  // Vite only watches its root. An app with a library outside it adds the folder itself.
  server.watcher.add(lib);
  await until(() => server.watcher.getWatched()[lib]?.includes('button.html'));
  const hot = server.environments.client.hot;
  const send = hot.send.bind(hot);
  hot.send = (payload, ...rest) => {
    sent.push(payload);
    return send(payload, ...rest);
  };
});

after(async () => {
  await server?.close();
  if (workspace) {
    await fs.rm(workspace, {recursive: true, force: true});
  }
});

test('a template edit outside the app root sends the id its component listens for', async () => {
  const compiled = await server.environments.client.transformRequest(`/@fs${button}`);
  // The HMR initializer: `const id = "<encoded id>"`, then a listener for `d.id === id`.
  const listened = /const id = "([^"]+)";\s*function Button_HmrLoad/.exec(compiled.code)?.[1];
  assert.ok(listened, `no HMR initializer in the compiled component:\n${compiled.code}`);

  sent = [];
  await fs.writeFile(path.join(path.dirname(button), 'button.html'), '<span>after</span>\n');
  const updates = () => sent.filter((p) => p.type === 'custom' && p.event === 'angular:component-update');
  await until(() => updates().length > 0);

  assert.deepEqual(updates().map((p) => decodeURIComponent(p.data.id)), [decodeURIComponent(listened)]);
  assert.equal(decodeURIComponent(listened), `${button.split(path.sep).join('/')}@Button`);
  assert.equal(sent.filter((p) => p.type === 'full-reload').length, 0);
});
