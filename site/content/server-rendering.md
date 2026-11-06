---
title: Server rendering
description: Render Angular on the server with vite-plugin-ngp, in the dev server and in builds, and prerender a static site the way this one is.
---

# Server rendering

With `ssr: true`, the plugin renders every page on the server in the dev server, and `vite build` builds a server bundle next to the browser one. This site is the worked example: an Angular app compiled by vite-plugin-ngp, rendered to static HTML with Angular SSR at build time, and hydrated in the browser. This page shows how to set up the same for your app, and what the plugin doesn't do for you.

## Turn it on

```ts
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp({ssr: true})],
});
```

`ssr: true` expects the server entry at `src/main.server.ts`. To use another file, write `ssr: {entry: 'src/server.ts'}`.

## The server entry

The entry renders one page. Its default export takes the URL and the contents of `index.html`, and resolves to the rendered HTML. This site's `src/main.server.ts`:

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

## What the plugin does

**In the dev server**, a middleware renders every page request through your entry, loaded by Vite's `ssr` environment. It passes the entry `index.html` as Vite transformed it, and returns the rendered page for the browser to hydrate. Edit a template and the browser updates in place, while the next server render shows the edit too.

This works in Vite's middleware mode too, when your own Node server mounts `vite.middlewares` (`server: {middlewareMode: true}`), and `vite.close()` shuts down the ngp compilers there as it does for `vite dev`. Leave `appType` at its default, `'spa'`: the middleware renders the requests Vite's SPA fallback rewrites to `index.html`, and with `appType: 'custom'` there's no fallback, so a request for `/` never reaches it and your server has to call `render` itself.

The server's Angular libraries are pre-bundled and cached, like the browser's. Vite leaves `node_modules` to Node in server environments and turns its dependency optimizer off there, so without this every Angular package was linked and transformed again on each start. The plugin turns the optimizer on for the `ssr` environment, scanning your server entry, and the linked bundle lives in `node_modules/.vite/deps_ssr` next to the browser's `deps`. It's rebuilt when the lockfile or the Vite config changes, when a library is first imported while the server runs, or with `vite --force`; `DEBUG=vite:deps` shows when. Only Angular libraries go into the bundle: rxjs and everything else they import stay with Node, so your app and the bundle share one copy. On the playground, a warm restart's first page went from 1.3 s to 0.74 s with the cache, measured on 17 October 2026 on an M2 Max as the median of six restarts. The first start after an install pays about 0.35 s to build the bundle.

One thing you give up: the server bundle has no source maps, because Vite read and combined them on every start, about 170 ms of the playground's first page. A server stack trace from inside Angular points into the readable, unminified file under `deps_ssr`, not into `@angular/core/fesm2022`. Your own modules keep their maps.

**In server environments**, the plugin compiles your components with their own ngp compiler, without HMR code, because HMR code imports updates from URLs only a browser can load. It defines `ngServerMode` as `true`. It also bundles every Angular library into the server build and links it: `@angular/*`, plus every package in your `dependencies` that depends on `@angular/core`, such as Angular Material or NgRx. Vite usually leaves `node_modules` for Node to load, and Node would load those libraries unlinked, which only works with the JIT compiler. An Angular library listed under `devDependencies` isn't found; add it to `resolve.noExternal` yourself.

**In `vite build`**, it builds both environments: the browser bundle into `dist/client`, and your entry into `dist/server/main.server.js`. Serving them is up to you, with any Node server that calls `render` for page requests and serves `dist/client` for everything else. With the `i18n` option, both folders get one subfolder per locale, such as `dist/server/de/main.server.js`, and your server picks the bundle by the URL's first segment. [Internationalization](i18n#serving-the-locales) has the details.

## Prerendering for static hosting

GitHub Pages serves files, not a Node server, so this site renders every route at build time instead. A short script imports the server bundle, renders each route into the built `index.html`, and writes the result where Pages expects it:

```ts
const template = await readFile('dist/client/index.html', 'utf8');
const {default: render, routes} = await import('./dist/server/main.server.js');

for (const route of routes) {
  const html = await render(`http://localhost/vite-plugin-ngp/${route}`, template);
  await writeFile(`dist/client/${route}/index.html`, html);
}
```

`routes` is a named export from the same server entry. It comes from the list that builds the site's router and sidebar, so a new page gets prerendered without touching the script. The site also renders a `404.html`, which GitHub Pages serves for any unknown path. Rendering the site's 16 pages took 5 to 29 ms each in the build of 17 October 2026, on an M2 Max.

## Limits

- **No status codes.** `render` returns HTML only. Behind a Node server, a not-found page answers 200. Angular's way to set the status, `@angular/ssr`'s request and response tokens, isn't wired up.
- **No `@angular/ssr` features.** Per-route render modes and `AngularNodeAppEngine` aren't supported. You write the server, or the prerender loop, yourself.
- **Two analyzers in dev.** The browser and server compilers each hold an ngp analyzer, so SSR roughly doubles the dev server's analyzer memory.
