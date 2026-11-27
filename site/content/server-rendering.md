---
title: Server rendering
description: Render Angular on the server with vite-plugin-ngp, with @angular/ssr as the Angular CLI sets it up or with a render function of your own, in the dev server and in builds.
---

# Server rendering

With `ssr: true`, the plugin renders every page on the server in the dev server, and `vite build` builds a server bundle next to the browser one. There are two ways to write the server side, and the plugin picks by what your app depends on:

- **With `@angular/ssr`**, the way `ng new --ssr` sets it up: an Express `server.ts` on `AngularNodeAppEngine`, server routes that choose each route's render mode, HTTP status codes and redirects, and prerendering in `vite build`. The `app-ssr` template of [`create-ngp`](vite-plus#create-a-new-app) scaffolds this. Use it unless you have a reason not to.
- **Without it**, a [`render(url, document)` function](server-rendering#the-server-entry) of your own, and a server you write. It's smaller and has no Express, but no status codes and no prerendering: you write that loop yourself. This site uses it, to prerender every page for GitHub Pages.

## Turn it on

```ts
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp({ssr: true})],
});
```

With [Vite+](vite-plus#server-rendering-under-vite), the same config works under `vp dev` and `vp build`. `ssr: true` expects the server entry at `src/main.server.ts`. To use another file, write `ssr: {entry: 'src/entry.server.ts'}`. That file joins the default [`entries`](configuration#when-to-change-them), so it gets `zone.js/node` and your other `polyfills` without listing it there. If you do set `entries`, it replaces the default: list the server entry and `src/main.ts` both.

## With @angular/ssr

When `@angular/ssr` is in your `package.json`, under `dependencies` or `devDependencies`, `ssr: true` means the Angular CLI's setup. Four files make it up, the same four `ng new --ssr` writes. The entry bootstraps the app and nothing more:

```ts title="src/main.server.ts"
import {bootstrapApplication, type BootstrapContext} from '@angular/platform-browser';
import {App} from './app/app';
import {config} from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
```

`app.config.server.ts` adds `provideServerRendering(withRoutes(serverRoutes))` to your app config, and `app.routes.server.ts` says how each route renders:

```ts title="src/app/app.routes.server.ts"
import {RenderMode, type ServerRoute} from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {path: '', renderMode: RenderMode.Prerender},
  {path: 'products/:id', renderMode: RenderMode.Server},
  {path: 'account', renderMode: RenderMode.Client},
  {path: '**', renderMode: RenderMode.Server, status: 404},
];
```

`src/server.ts` is the Node server: an Express app that serves the browser build as static files and hands every other request to `AngularNodeAppEngine`. It's the CLI's file with one change: the browser build is in `../client`, not `../browser`.

```ts title="src/server.ts"
const browserDistFolder = join(import.meta.dirname, '../client');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.static(browserDistFolder, {maxAge: '1y', index: false, redirect: false}));
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  app.listen(process.env['PORT'] || 4000);
}

export const reqHandler = createNodeRequestHandler(app);
```

To keep the server somewhere else, name it: `ssr: {server: 'server/main.ts'}`. Without a `server.ts`, the dev server still renders pages, and `vite build` builds `main.server.js` alone for a server you bring.

**In the dev server**, every request Vite doesn't answer itself goes to `server.ts`'s `reqHandler`, so the API routes you add there answer in dev too. Pages render with `index.html` as Vite transformed it, plus the script [event replay](server-rendering#event-replay) needs, and `Prerender` routes render on each request, as `ng serve` renders them. Angular's host check is off in dev: Vite already checks the `Host` header against `server.allowedHosts`. After you edit a file, the next request starts a fresh Angular server app, so it sees the edit.

**In `vite build`**, the server folder gets what the CLI's does, with `.js` where the CLI writes `.mjs`:

| File | What it is |
|---|---|
| `dist/server/server.js` | Your `server.ts`. Run it with `node dist/server/server.js` |
| `dist/server/main.server.js` | The app, as `AngularNodeAppEngine` loads it |
| `dist/server/angular-app-manifest.mjs` | The route tree, and the HTML each page renders into |
| `dist/server/angular-app-engine-manifest.mjs` | The base path and the allowed hosts |

Then the build prerenders. It loads the server bundle in a worker thread, finds the routes as the CLI does, calling `getPrerenderParams` for parameterized ones, and renders every `Prerender` route. Each page goes to `dist/client/<route>/index.html` and into the manifest, from which the engine serves it with an `ETag`. A route that fails to render fails the build, and so does a `Prerender` route with parameters but no `getPrerenderParams`, as in `ng build`. A parameter value `getPrerenderParams` didn't list is rendered on request, unless the route's `fallback` says otherwise.

**Allowed hosts.** `AngularNodeAppEngine` answers a `Host` it doesn't know with 400, to stop server-side request forgery. The build allows `localhost`. List the hosts your server answers for in `ssr: {allowedHosts: ['example.com']}`, which takes the place of angular.json's `security.allowedHosts`, or in `NG_ALLOWED_HOSTS` when the server starts.

**Coming from the CLI**, the four files move over as they are, except `browserDistFolder`. angular.json's `server`, `ssr.entry`, `prerender` and `outputMode` have no counterpart: the files above are found by name, and the build always prerenders what the server routes ask for, like `outputMode: 'server'`. Vite's `base` becomes the base href.

## The server entry

Without `@angular/ssr`, the entry renders one page. Its default export takes the URL and the contents of `index.html`, and resolves to the rendered HTML. This site's `src/main.server.ts`:

```ts title="src/main.server.ts"
import {mergeApplicationConfig} from '@angular/core';
import {bootstrapApplication, type BootstrapContext} from '@angular/platform-browser';
import {provideServerRendering, renderApplication} from '@angular/platform-server';
import {App} from './app/app';
import {appConfig} from './app/app.config';

const serverConfig = mergeApplicationConfig(appConfig, {providers: [provideServerRendering()]});

export default function render(url: string, document: string): Promise<string> {
  return renderApplication((context: BootstrapContext) => bootstrapApplication(App, serverConfig, context), {
    document,
    url,
    allowedHosts: ['localhost'],
  });
}
```

> [!IMPORTANT]
> `allowedHosts` matters: Angular refuses to render a URL whose host it hasn't been told to trust, with error `NG05706`. List the hosts your server answers for.

The browser side adds hydration, so Angular reuses the server's DOM instead of rendering the page again:

```ts
provideClientHydration(withEventReplay())
```

## Event replay

`withEventReplay()` queues the clicks a user makes before the app has hydrated, and replays them once it has. It depends on a script at the top of the page, Angular's event dispatch contract, 476 bytes in Angular 22.3.0-rc.0. Angular's server renderer doesn't add that script. It looks for it in the document it renders into: when it's there, the renderer adds a `window.__jsaction_bootstrap(...)` call after it, or takes the script out again if hydration is off or the page has no listeners. When it isn't there, the renderer does nothing and says nothing, and early clicks are lost.

The Angular CLI puts the script in at build time, and so does the plugin: right after `<body>`, read from your app's `@angular/core`, into the document the server renders into. The browser's own `index.html` never gets it, since a page nobody rendered has nothing to replay.

- **In the dev server**, the plugin adds it after Vite has transformed `index.html`, before `render` or `@angular/ssr` gets the document. You change nothing.
- **With `@angular/ssr`**, `vite build` adds it to the document in the manifest that pages render into, so prerendered pages and pages rendered on request both replay. A `Client` route is answered with the other document, without it. You change nothing.
- **With `render`**, `vite build` writes `dist/server/index.server.html`, the built `index.html` plus the script. Pass that file to `render`, where you passed `dist/client/index.html` before:

```ts
const template = await readFile('dist/server/index.server.html', 'utf8');
const html = await render(url, template);
```

A server that still reads `dist/client/index.html` renders as it did, and loses early clicks with no error: that's the one step of this that's on you. With `i18n`, each locale has its own file, such as `dist/server/de/index.server.html`.

If your page has a CSP nonce, the script gets it: the value of an `ngCspNonce` attribute in `index.html`, as in the CLI, else Vite's `html.cspNonce`. The CLI copies the nonce to every other inline script and style too; the plugin only handles the script it adds.

Checked on the playground on 27 November 2026, in Chromium, with every script held back until after a click on the Signals page's counter: once the app hydrated the counter read 1, in the dev server and from the build in both locales. With the two scripts cut from the same page it stayed at 0.

## What the plugin does

**In the dev server**, a middleware renders every page request through your entry, loaded by Vite's `ssr` environment, or through `@angular/ssr` [as above](server-rendering#with-angular-ssr). It passes the entry `index.html` as Vite transformed it, with the [event replay](server-rendering#event-replay) script, and returns the rendered page for the browser to hydrate. Edit a template and the browser updates in place, while the next server render shows the edit too.

This works in Vite's middleware mode too, when your own Node server mounts `vite.middlewares` (`server: {middlewareMode: true}`), and `vite.close()` shuts down the ngp compilers there as it does for `vite dev`. Leave `appType` at its default, `'spa'`: the middleware renders the requests Vite's SPA fallback rewrites to `index.html`, and with `appType: 'custom'` there's no fallback, so a request for `/` never reaches it and your server has to call `render` itself.

The server's Angular libraries are pre-bundled and cached, like the browser's. Vite leaves `node_modules` to Node in server environments and turns its dependency optimizer off there, so without this every Angular package was linked and transformed again on each start. The plugin turns the optimizer on for the `ssr` environment, scanning your server entry, and the linked bundle lives in `node_modules/.vite/deps_ssr` next to the browser's `deps`. It's rebuilt when the lockfile or the Vite config changes, when a library is first imported while the server runs, or with `vite --force`; `DEBUG=vite:deps` shows when. Only Angular libraries go into the bundle: rxjs and everything else they import stay with Node, so your app and the bundle share one copy. On the playground, a warm restart's first page went from 1.3 s to 0.74 s with the cache, measured on 17 October 2026 on an M2 Max as the median of six restarts. The first start after an install pays about 0.35 s to build the bundle.

One thing you give up: the server bundle has no source maps, because Vite read and combined them on every start, about 170 ms of the playground's first page. A server stack trace from inside Angular points into the readable, unminified file under `deps_ssr`, not into `@angular/core/fesm2022`. Your own modules keep their maps.

**In server environments**, the plugin compiles your components with their own ngp compiler, without HMR code, because HMR code imports updates from URLs only a browser can load. It defines `ngServerMode` as `true`. It also bundles every Angular library into the server build and links it: `@angular/*`, plus every package in your `dependencies` that depends on `@angular/core`, such as Angular Material or NgRx. Vite usually leaves `node_modules` for Node to load, and Node would load those libraries unlinked, which only works with the JIT compiler. An Angular library listed under `devDependencies` isn't found; add it to `resolve.noExternal` yourself.

With `@angular/ssr`, `@angular/ssr` itself, beasties, which it uses to inline critical CSS, and beasties' dependencies are bundled too: pnpm keeps beasties out of your app's reach, so Node couldn't load it from the bundle. Express and the rest of what `server.ts` imports stay with Node.

**In `vite build`**, it builds both environments: the browser bundle into `<outDir>/client`, and your entry into `<outDir>/server/main.server.js`, with [`index.server.html`](server-rendering#event-replay) next to it, where `<outDir>` is your `build.outDir` and defaults to `dist`. With the default, that's `dist/client` and `dist/server`, the paths the rest of this page uses. An `outDir` you set on the `client` or `ssr` environment itself wins over both. With `@angular/ssr`, the server folder also gets `server.js` and the manifests, as [above](server-rendering#with-angular-ssr). Without it, serving them is up to you, with any Node server that calls `render` with `dist/server/index.server.html` for page requests and serves `dist/client` for everything else. With the `i18n` option, both folders get one subfolder per locale, such as `dist/server/de/main.server.js`, and your server picks the bundle by the URL's first segment. [Internationalization](i18n#serving-the-locales) has the details.

## Prerendering for static hosting

With `@angular/ssr`, `RenderMode.Prerender` on every route does this for you, and `dist/client` is then a static site. This site predates that and uses `render`: GitHub Pages serves files, not a Node server, so a short script imports the server bundle, renders each route into the build's [`index.server.html`](server-rendering#event-replay), and writes the result where Pages expects it:

```ts
const template = await readFile('dist/server/index.server.html', 'utf8');
const {default: render, routes} = await import('./dist/server/main.server.js');

for (const route of routes) {
  const html = await render(`http://localhost/vite-plugin-ngp/${route}`, template);
  await writeFile(`dist/client/${route}/index.html`, html);
}
```

`routes` is a named export from the same server entry. It comes from the list that builds the site's router and sidebar, so a new page gets prerendered without touching the script. The site also renders a `404.html`, which GitHub Pages serves for any unknown path. Rendering the site's 16 pages took 5 to 29 ms each in the build of 17 October 2026, on an M2 Max.

## Limits

- **`render` has no status codes.** It returns HTML only, so behind your own server a not-found page answers 200. Use `@angular/ssr` for status codes, redirects and headers.
- **`@angular/ssr` serves one locale.** With the `i18n` option, the build stops with an error; per-locale server bundles work only with `render`. There's no app shell (`withAppShell`) and no critical CSS inlining, and the manifest has no preload hints for lazy routes, which `ng build` adds. The build prerenders one route at a time, in one worker, where the CLI uses a pool.
- **`@angular/ssr` uses its internal API.** The manifests and the functions that read them are `ɵ` exports, which Angular can change in any release. The plugin is checked against the Angular release on the [Compatibility](compatibility) page, like the rest of it.
- **The `ssr` option means Node.** It adds a Node middleware, a server build input and output folder, and a pre-bundle that leaves non-Angular packages for Node to load. When another plugin owns the server environment, such as `@cloudflare/vite-plugin` running it in workerd, leave `ssr` off and list the server entry in `entries`. The plugin still compiles that environment's components for the server and links its Angular libraries, in the dev server and in builds. It never sees the document that server renders into, though, so [event replay](server-rendering#event-replay) is yours to set up there: put the contents of `@angular/core/event-dispatch-contract.min.js` in a `<script type="text/javascript" id="ng-event-dispatch-contract">` right after `<body>` before you render. `import contract from '@angular/core/event-dispatch-contract.min.js?raw'` gives server code the file as a string, in the dev server and in a build. That import was checked in the plugin's Node environment, not in workerd.
- **Two analyzers in dev.** The browser and server compilers each hold an ngp analyzer, so SSR roughly doubles the dev server's analyzer memory.
