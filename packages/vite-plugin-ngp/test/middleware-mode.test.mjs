// A dev server in middleware mode, the way a custom Node server hosts Vite: it has no HTTP server
// of its own. The plugin still renders pages through the host's server, and closing the Vite
// server closes the ngp analyzers. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as path from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';
import {ngp} from '../dist/index.js';
import {copyFixture, toolchain} from './fixture.mjs';

test('middleware mode: pages render through the host server, and close() closes the compilers', async () => {
  const root = await copyFixture('ng-build-app', 'middleware-mode');
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    logLevel: 'silent',
    server: {middlewareMode: true, ws: false},
    // No type-check: nothing here looks at it.
    plugins: ngp({toolchain, polyfills: ['zone.js'], ssr: true, typeCheck: false}),
  });
  let open = true;
  try {
    assert.equal(server.httpServer, null, 'middleware mode has no HTTP server');
    const host = http.createServer(server.middlewares);
    try {
      await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
      const {port} = host.address();
      const response = await fetch(`http://127.0.0.1:${port}/`, {headers: {accept: 'text/html'}});
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /id="status">loaded</, 'the page is rendered on the server');

      // The browser's compiler too, so both consumers have one to close.
      await server.environments.client.transformRequest('/src/app.ts');
    } finally {
      // fetch keeps its connection alive, and close() would wait for it.
      await new Promise((resolve) => {
        host.close(resolve);
        host.closeAllConnections();
      });
    }

    const {api} = server.config.plugins.find((p) => p.name === 'vite-plugin-ngp');
    const closed = [];
    for (const consumer of ['client', 'server']) {
      const compiler = await api.getCompiler(consumer);
      const close = compiler.close.bind(compiler);
      compiler.close = () => {
        closed.push(consumer);
        close();
      };
    }
    open = false;
    await server.close();
    assert.deepEqual(closed.sort(), ['client', 'server'], 'server.close() closes each compiler once');
  } finally {
    if (open) {
      await server.close();
    }
  }
});
