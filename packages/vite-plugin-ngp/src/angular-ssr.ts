// Angular's own server rendering, `@angular/ssr`, on top of the plugin's `ssr` option: the
// `AngularNodeAppEngine` a CLI app's `server.ts` uses, server routes with render modes, status
// codes and redirects, and prerendering in `vite build`.
//
// `@angular/ssr` reads two manifests the Angular CLI writes next to the server bundle: the app
// manifest (how to bootstrap, the HTML it renders into, the route tree, the prerendered pages) and
// the engine manifest (which server bundle answers which URL). The plugin writes the same two.
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {Worker} from 'node:worker_threads';
import {isRunnableDevEnvironment, type Connect, type Plugin, type ResolvedConfig, type ViteDevServer} from 'vite';
import {polyfillImports} from './polyfills.js';

/** The app's server entry and Node server, as absolute paths. */
export interface AngularSsrFiles {
  /** `src/main.server.ts`: default-exports the bootstrap function, as in a CLI app. */
  mainServer: string;
  /** `src/server.ts`: the Node server, built into `server.js`. Null when the app has none. */
  server: string | null;
}

/** The generated entries. `vite build` writes them as `main.server.js` and `server.js`. */
export const MAIN_SERVER_ID = 'virtual:ngp-ssr/main-server';
export const SERVER_ID = 'virtual:ngp-ssr/server';
/** Imported first by each entry, so the manifest is set before any app code reads it. */
const APP_MANIFEST_ID = 'virtual:ngp-ssr/app-manifest';
const ENGINE_MANIFEST_ID = 'virtual:ngp-ssr/engine-manifest';
const VIRTUAL = /^virtual:ngp-ssr\//;

/** The CLI's file names. Written after the bundle, since they hold the prerendered pages. */
const APP_MANIFEST_FILE = 'angular-app-manifest.mjs';
const ENGINE_MANIFEST_FILE = 'angular-app-engine-manifest.mjs';
const ASSETS_DIR = 'assets-chunks';

/** One route of `@angular/ssr`'s serialized route tree. */
interface SerializedRoute {
  route: string;
  renderMode?: number;
  redirectTo?: string;
}

/** What the prerender worker reports. */
interface PrerenderResult {
  routes: SerializedRoute[];
  pages: {route: string; html: string}[];
  errors: string[];
}

/** The slice of `@angular/ssr` that the dev middleware calls, through `MAIN_SERVER_ID`. */
interface MainServerExports {
  ɵgetOrCreateAngularServerApp(options: {allowStaticRouteRender: boolean}): AngularServerApp;
  ɵdestroyAngularServerApp(): void;
  createWebRequestFromNodeRequest(req: Connect.IncomingMessage): Request;
  writeResponseToNodeResponse(response: Response, res: unknown): Promise<void>;
}

interface AngularServerApp {
  hooks: Hooks;
  handle(request: Request): Promise<Response | null>;
}

interface Hooks {
  on(name: 'html:transform:pre', handler: (context: {html: string; url: URL}) => Promise<string>): void;
}

/** The slice of `SERVER_ID`'s exports the dev middleware uses. */
interface ServerExports {
  reqHandler?: unknown;
  AngularAppEngine: {ɵallowStaticRouteRender: boolean; ɵdisableAllowedHostsCheck: boolean; ɵhooks: Hooks};
}

/** Whether the app depends on `@angular/ssr`, which switches the `ssr` option to Angular's engine. */
export function usesAngularSsr(root: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    return '@angular/ssr' in {...pkg['dependencies'], ...pkg['devDependencies']};
  } catch {
    return false;
  }
}

/** `base` as Angular's `baseHref`: always absolute, with a trailing slash. */
function baseHrefOf(base: string): string {
  return base.startsWith('/') ? (base.endsWith('/') ? base : `${base}/`) : '/';
}

/** The engine's `basePath`: the base href without its trailing slash, except for `/`. */
function basePathOf(baseHref: string): string {
  return baseHref.length > 1 ? baseHref.slice(0, -1) : baseHref;
}

const posix = (file: string) => file.split(path.sep).join('/');

/**
 * The generated entries and manifests. In the dev server the manifests are modules that read
 * index.html from the project. In `vite build` the entries import the manifest files, which are
 * left out of the bundle and written once the prerendered pages are known.
 */
export function angularSsrPlugin(getFiles: () => AngularSsrFiles | null, allowedHosts: string[], polyfills: () => string[]): Plugin {
  let config: ResolvedConfig;
  const manifestFiles = new Set([`./${APP_MANIFEST_FILE}`, `./${ENGINE_MANIFEST_FILE}`]);
  return {
    name: 'vite-plugin-ngp:angular-ssr',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
    },
    resolveId: {
      filter: {id: [VIRTUAL, /^\.\/angular-app(?:-engine)?-manifest\.mjs$/]},
      handler(id, importer) {
        if (!getFiles()) {
          return null;
        }
        if (VIRTUAL.test(id)) {
          return `\0${id}`;
        }
        // The manifest files, imported only by the generated modules, in builds.
        return importer?.startsWith('\0virtual:ngp-ssr/') && manifestFiles.has(id) ? {id, external: true} : null;
      },
    },
    load: {
      filter: {id: /^\0virtual:ngp-ssr\//},
      handler(id) {
        const files = getFiles();
        if (!files) {
          return null;
        }
        const build = config.command === 'build';
        const imports = (specifiers: string[]) => specifiers.map((s) => `import ${JSON.stringify(s)};`);
        // The server's polyfills come first, as in the CLI's server bundle: zone.js has to patch
        // Promise before @angular/core loads.
        const server = polyfillImports(polyfills(), config.root, 'server');
        const mainServer = JSON.stringify(posix(files.mainServer));
        switch (id.slice(1)) {
          case MAIN_SERVER_ID:
            return [
              ...imports([...server, APP_MANIFEST_ID]),
              `export { ɵdestroyAngularServerApp, ɵextractRoutesAndCreateRouteTree, ɵgetOrCreateAngularServerApp } from '@angular/ssr';`,
              // What the dev middleware needs from Node's side, loaded with the same Angular.
              ...(build ? [] : [`export { createWebRequestFromNodeRequest, writeResponseToNodeResponse } from '@angular/ssr/node';`]),
              `export { default } from ${mainServer};`,
              `export * from ${mainServer};`,
            ].join('\n');
          case SERVER_ID: {
            const serverFile = JSON.stringify(posix(files.server!));
            return [
              ...imports([...server, ENGINE_MANIFEST_ID]),
              `import * as server from ${serverFile};`,
              `export * from ${serverFile};`,
              // A default export only when server.ts has one, without a bundler warning when it doesn't.
              `const name = 'default';`,
              `export default server[name];`,
              `export { AngularAppEngine } from '@angular/ssr';`,
            ].join('\n');
          }
          case APP_MANIFEST_ID: {
            const set = `import { ɵsetAngularAppManifest } from '@angular/ssr';`;
            if (build) {
              return `${set}\nimport manifest from './${APP_MANIFEST_FILE}';\nɵsetAngularAppManifest(manifest);`;
            }
            const index = JSON.stringify(posix(path.join(config.root, 'index.html')));
            return [
              set,
              `import { readFile } from 'node:fs/promises';`,
              `const index = { hash: '', size: 0, text: () => readFile(${index}, 'utf8') };`,
              `ɵsetAngularAppManifest({`,
              `  baseHref: ${JSON.stringify(baseHrefOf(config.base))},`,
              `  bootstrap: () => import(${mainServer}).then((m) => m.default),`,
              `  assets: { 'index.server.html': index, 'index.csr.html': index },`,
              `});`,
            ].join('\n');
          }
          case ENGINE_MANIFEST_ID: {
            const set = `import { ɵsetAngularAppEngineManifest } from '@angular/ssr';`;
            if (build) {
              return `${set}\nimport manifest from './${ENGINE_MANIFEST_FILE}';\nɵsetAngularAppEngineManifest(manifest);`;
            }
            return `${set}\nɵsetAngularAppEngineManifest(${engineManifest(basePathOf(baseHrefOf(config.base)), allowedHosts, `() => import(${JSON.stringify(MAIN_SERVER_ID)})`)});`;
          }
        }
        return null;
      },
    },

    // Rolldown puts the chunk the two entries share, Angular included, ahead of the polyfills
    // each entry imports first. zone.js has to patch Promise before anything else loads, so it
    // goes first in each entry chunk, as the CLI's server bundle has it in a banner.
    renderChunk(code, chunk) {
      if (!getFiles() || config.command !== 'build' || this.environment.name !== 'ssr' || !chunk.isEntry) {
        return null;
      }
      const zone = polyfillImports(polyfills(), config.root, 'server').filter((p) => p === 'zone.js/node');
      return zone.length > 0 ? {code: `import 'zone.js/node';\n${code}`, map: null} : null;
    },

    // After the server bundle is written: write the manifests, then prerender in a worker, which
    // loads the bundle with a fresh copy of Angular and its own globals, and write the manifest
    // again with the pages and the route tree.
    async writeBundle(output) {
      if (!getFiles() || config.command !== 'build' || this.environment.name !== 'ssr' || !output.dir) {
        return;
      }
      const serverDir = output.dir;
      const clientConfig = this.environment.getTopLevelConfig().environments['client'];
      const clientDir = path.resolve(config.root, clientConfig?.build.outDir ?? config.build.outDir);
      const indexFile = path.join(clientDir, 'index.html');
      if (!fs.existsSync(indexFile)) {
        this.error(`[vite-plugin-ngp] ${indexFile} is missing: the browser build has to run before the server build`);
      }
      const baseHref = baseHrefOf(config.base);
      const shell = await fs.promises.readFile(indexFile, 'utf8');
      const assets = new Map([
        ['index.server.html', shell],
        ['index.csr.html', shell],
      ]);
      await fs.promises.writeFile(
        path.join(serverDir, ENGINE_MANIFEST_FILE),
        `export default ${engineManifest(basePathOf(baseHref), allowedHosts, `() => import('./main.server.js')`)};\n`,
      );
      await writeAppManifest(serverDir, baseHref, assets, undefined);

      const started = performance.now();
      const result = await prerender(path.join(serverDir, 'main.server.js'));
      if (result.errors.length > 0) {
        this.error(`[vite-plugin-ngp] prerendering failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
      }
      const written: string[] = [];
      for (const {route, html} of result.pages) {
        const page = pagePath(route, baseHref);
        assets.set(page, html);
        await fs.promises.mkdir(path.dirname(path.join(clientDir, page)), {recursive: true});
        await fs.promises.writeFile(path.join(clientDir, page), html);
        written.push(page);
      }
      await writeAppManifest(serverDir, baseHref, assets, result.routes);
      if (written.length > 0) {
        config.logger.info(
          `[vite-plugin-ngp] prerendered ${written.length} ${written.length === 1 ? 'route' : 'routes'} in ${Math.round(performance.now() - started)} ms`,
        );
      }
    },
  };
}

/** The engine manifest's source. `entry` is the code that imports the server entry. */
function engineManifest(basePath: string, allowedHosts: string[], entry: string): string {
  return [
    '{',
    `  basePath: ${JSON.stringify(basePath)},`,
    `  allowedHosts: ${JSON.stringify(allowedHosts)},`,
    // One locale, at the root. `@angular/ssr` only uses the keys to pick a locale's bundle.
    `  supportedLocales: { 'en-US': '' },`,
    `  entryPoints: { '': ${entry} },`,
    '}',
  ].join('\n');
}

/**
 * Writes the app manifest and one module per HTML asset, which the manifest imports when a page
 * asks for it, as the CLI does.
 */
async function writeAppManifest(serverDir: string, baseHref: string, assets: Map<string, string>, routes: SerializedRoute[] | undefined) {
  const assetsDir = path.join(serverDir, ASSETS_DIR);
  await fs.promises.rm(assetsDir, {recursive: true, force: true});
  await fs.promises.mkdir(assetsDir, {recursive: true});
  const entries: string[] = [];
  for (const [name, html] of assets) {
    const file = `${ASSETS_DIR}/${name.replace(/[./]/g, '_')}.mjs`;
    await fs.promises.writeFile(path.join(serverDir, file), `export default ${JSON.stringify(html)};\n`);
    const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
    entries.push(
      `    ${JSON.stringify(name)}: { size: ${Buffer.byteLength(html)}, hash: ${JSON.stringify(hash)}, text: () => import(${JSON.stringify(`./${file}`)}).then((m) => m.default) },`,
    );
  }
  const source = [
    'export default {',
    `  bootstrap: () => import('./main.server.js').then((m) => m.default),`,
    `  baseHref: ${JSON.stringify(baseHref)},`,
    ...(routes ? [`  routes: ${JSON.stringify(routes)},`] : []),
    '  assets: {',
    ...entries,
    '  },',
    '};',
    '',
  ].join('\n');
  await fs.promises.writeFile(path.join(serverDir, APP_MANIFEST_FILE), source);
}

/** Where a prerendered route's page goes, relative to the browser build: `about/index.html`. */
function pagePath(route: string, baseHref: string): string {
  let page = route;
  if (baseHref.length > 1 && page.startsWith(baseHref.slice(0, -1))) {
    page = page.slice(baseHref.length - 1);
  }
  page = page.replace(/^\/+|\/+$/g, '');
  return page ? `${page}/index.html` : 'index.html';
}

/** Runs the prerender worker on the built server entry. */
function prerender(entry: string): Promise<PrerenderResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./prerender-worker.js', import.meta.url), {workerData: {entry}});
    worker.once('message', (result: PrerenderResult) => {
      resolve(result);
      // The app may leave timers running; nothing else is coming.
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`the prerender worker exited with code ${code}`)));
  });
}

/** Whether a request is for a page: what Vite's SPA fallback rewrote to an `.html` file. */
function isPageRequest(req: Connect.IncomingMessage): boolean {
  const pathname = (req.url ?? '').replace(/[?#].*$/, '');
  return req.method === 'GET' && pathname.endsWith('.html') && (req.headers.accept ?? '').includes('text/html');
}

/** `createNodeRequestHandler` and `createRequestHandler` from `@angular/ssr` mark what they return. */
function handlerKind(value: unknown): 'node' | 'web' | null {
  if (typeof value !== 'function') {
    return null;
  }
  return '__ng_node_request_handler__' in value ? 'node' : '__ng_request_handler__' in value ? 'web' : null;
}

/**
 * Renders pages in the dev server with `@angular/ssr`. With a `server.ts` that exports
 * `reqHandler`, every request Vite doesn't answer goes to it, so its own routes work in dev too.
 * Otherwise the plugin hands page requests to Angular's server app directly. Prerendered routes
 * render on each request, as `ng serve` renders them.
 */
export function angularSsrDevMiddleware(server: ViteDevServer, files: AngularSsrFiles): Connect.NextHandleFunction {
  // Angular keeps one server app, with its route tree and bootstrap, for the life of the process.
  // After an edit, the next request starts a new one from the reloaded modules.
  let stale = false;
  for (const event of ['change', 'add', 'unlink'] as const) {
    server.watcher.on(event, () => {
      stale = true;
    });
  }
  const transform = ({html, url}: {html: string; url: URL}) => server.transformIndexHtml(url.pathname, html, url.pathname + url.search);
  let hookedApp: AngularServerApp | null = null;
  let hookedEngine: ServerExports['AngularAppEngine'] | null = null;
  let warned = false;
  return (req, res, next) => {
    void (async () => {
      const environment = server.environments['ssr'];
      if (!environment || !isRunnableDevEnvironment(environment)) {
        throw new Error('the ssr environment has no module runner');
      }
      const main = await environment.runner.import<MainServerExports>(MAIN_SERVER_ID);
      if (stale) {
        stale = false;
        main.ɵdestroyAngularServerApp();
      }
      // Vite's SPA fallback rewrote page requests to /index.html; Angular needs the URL asked for.
      const page = isPageRequest(req);
      req.url = req.originalUrl ?? req.url;
      if (files.server) {
        const exports = await environment.runner.import<ServerExports>(SERVER_ID);
        const kind = handlerKind(exports.reqHandler);
        if (kind) {
          const engine = exports.AngularAppEngine;
          if (hookedEngine !== engine) {
            // Vite checks the Host header itself (`server.allowedHosts`).
            engine.ɵdisableAllowedHostsCheck = true;
            engine.ɵallowStaticRouteRender = true;
            engine.ɵhooks.on('html:transform:pre', transform);
            hookedEngine = engine;
          }
          if (kind === 'node') {
            await (exports.reqHandler as (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>)(req, res, next);
            return;
          }
          const response = await (exports.reqHandler as (request: Request) => Promise<Response | null>)(main.createWebRequestFromNodeRequest(req));
          return response ? main.writeResponseToNodeResponse(response, res) : next();
        }
        if (!warned) {
          warned = true;
          server.config.logger.warn(
            `[vite-plugin-ngp] ${path.relative(server.config.root, files.server)} doesn't export a reqHandler made by createNodeRequestHandler or createRequestHandler, so the dev server renders pages without it`,
          );
        }
      }
      if (!page) {
        return next();
      }
      const app = main.ɵgetOrCreateAngularServerApp({allowStaticRouteRender: true});
      if (hookedApp !== app) {
        app.hooks.on('html:transform:pre', transform);
        hookedApp = app;
      }
      const response = await app.handle(main.createWebRequestFromNodeRequest(req));
      return response ? main.writeResponseToNodeResponse(response, res) : next();
    })().catch((error: unknown) => {
      if (error instanceof Error) {
        server.ssrFixStacktrace(error);
      }
      next(error);
    });
  };
}
