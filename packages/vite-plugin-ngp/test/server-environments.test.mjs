// Angular libraries reach every server environment linked, including one the plugin doesn't own,
// like the Worker environment the Cloudflare plugin adds. Run `pnpm build` first; needs an ngp
// toolchain build.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';
import {ngp} from '../dist/index.js';
import {copyFixture, toolchain} from './fixture.mjs';

const linkerOf = (plugins) => plugins.find((p) => p.name === 'vite-plugin-ngp:linker');

test('the linker takes dependencies the dev server serves with a version query', () => {
  const {include, exclude} = linkerOf(ngp({toolchain})).transform.filter.id;
  for (const id of [
    '/app/node_modules/@angular/common/fesm2022/common.mjs',
    '/app/node_modules/@angular/common/fesm2022/common.mjs?v=6288c9a3',
    '/app/node_modules/ui-kit/index.js#hash',
  ]) {
    assert.ok(include.test(id) && !exclude.test(id), id);
  }
  assert.ok(!include.test('/app/node_modules/ui-kit/index.json'));
  assert.ok(!include.test('/app/node_modules/ui-kit/index.mjs.map?v=1'));
  assert.ok(exclude.test('/app/node_modules/.vite/deps/@angular_common.js?v=6288c9a3'));
});

test('a server environment the plugin does not own pre-bundles Angular libraries linked', async () => {
  const root = await copyFixture('ng-build-app', 'server-environments');
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    server: {middlewareMode: true, ws: false},
    environments: {worker: {consumer: 'server'}},
    plugins: ngp({toolchain}),
  });
  try {
    const plugins = server.environments.worker.config.optimizeDeps.rolldownOptions?.plugins ?? [];
    assert.ok(linkerOf(plugins.flat()), 'the worker optimizer runs the linker');
  } finally {
    await server.close();
  }
});
