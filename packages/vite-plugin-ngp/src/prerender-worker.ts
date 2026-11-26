// Runs in a worker thread after `vite build` writes the server bundle: finds the app's routes the
// way the Angular CLI does, and renders every route whose render mode is `Prerender`. A worker
// keeps the bundle's zone.js and Angular out of Vite's process.
import {parentPort, workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';

interface SerializedRoute {
  route: string;
  renderMode?: number;
  redirectTo?: string;
}

interface MainServer {
  ɵextractRoutesAndCreateRouteTree(options: {
    url: URL;
    invokeGetPrerenderParams: boolean;
    includePrerenderFallbackRoutes: boolean;
    signal: AbortSignal;
  }): Promise<{routeTree: {toObject(): SerializedRoute[]}; errors: string[]}>;
  ɵgetOrCreateAngularServerApp(options: {allowStaticRouteRender: boolean}): {handle(request: Request): Promise<Response | null>};
}

const RENDER_MODE_PRERENDER = 2;
const TIMEOUT_MS = 30_000;
const origin = 'http://localhost';

const {entry} = workerData as {entry: string};
const errors: string[] = [];
const pages: {route: string; html: string}[] = [];
let routes: SerializedRoute[] = [];
const message = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error));

try {
  const main = (await import(pathToFileURL(entry).href)) as MainServer;
  const extracted = await main.ɵextractRoutesAndCreateRouteTree({
    url: new URL(origin),
    // Expands `getPrerenderParams` into one route per parameter set, and keeps the routes with
    // parameters for the server to render, as `ng build` with `outputMode: 'server'` does.
    invokeGetPrerenderParams: true,
    includePrerenderFallbackRoutes: true,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  errors.push(...extracted.errors);
  routes = extracted.routeTree.toObject();
  const app = main.ɵgetOrCreateAngularServerApp({allowStaticRouteRender: true});
  for (const {route, renderMode, redirectTo} of routes) {
    // Redirects are answered by the server from the route tree. A route that still has a
    // parameter or a wildcard is its fallback, rendered on request.
    if (renderMode !== RENDER_MODE_PRERENDER || redirectTo !== undefined || /(?:^|\/)(?::|\*)/.test(route)) {
      continue;
    }
    try {
      const response = await app.handle(new Request(new URL(route, origin), {signal: AbortSignal.timeout(TIMEOUT_MS)}));
      if (!response) {
        throw new Error('Angular rendered nothing for it');
      }
      pages.push({route, html: await response.text()});
    } catch (error) {
      errors.push(`${route}: ${message(error)}`);
    }
  }
} catch (error) {
  errors.push(message(error));
}

parentPort!.postMessage({routes, pages, errors});
