---
title: Migrating from ng build
description: Where each angular.json build option goes when an app moves from ng build to vite-plugin-ngp, and which ones can't move yet.
---

# Migrating from ng build

You have an app that `ng build` builds from angular.json, with the `@angular/build:application` builder, and you want to know whether it can move to Vite with this plugin. Most of angular.json's build options become Vite config you'd write for any Vite app. Three have no Vite equivalent, so the plugin takes them, under the same names and in the same shapes: `fileReplacements`, `budgets` and `polyfills`. The project's `i18n` block and the `localize` option become the plugin's `i18n` option. A handful of options can't move at all yet.

Check [Can't move yet](migrating-from-ng-build#cant-move-yet) first. If your production build depends on any of those, stay on `ng build` for now. Then follow [Getting started](getting-started) for the toolchain, the pinned Angular version and `index.html`, and come back here for the rest. If the app lives in an Nx workspace, [Migrating inside an Nx workspace](nx) adds what the workspace needs: Vite's root, tsconfig paths and the libraries the app imports.

## Configurations become modes

angular.json picks options per configuration, `production` and `development`. Vite has modes: `vite build` runs in `production`, the dev server in `development`, and `--mode` picks another. Write your config as a function of `mode` to get the same effect:

```ts
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig(({mode}) => ({
  plugins: [
    ngp({
      polyfills: ['zone.js'],
      fileReplacements:
        mode === 'production' ? [{replace: 'src/environments/environment.ts', with: 'src/environments/environment.prod.ts'}] : [],
      budgets: [
        {type: 'initial', maximumWarning: '500kB', maximumError: '1MB'},
        {type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB'},
      ],
    }),
  ],
}));
```

The plugin doesn't read angular.json. Copy the options over, and delete angular.json once nothing else needs it.

## File replacements

`fileReplacements` takes angular.json's array unchanged. Paths are relative to Vite's root, which is your project root if `index.html` sits there.

Vite alone can't do this for an Angular app. ngp's analyzer reads your sources from disk, following imports, so if only Vite swapped `environment.ts` for `environment.prod.ts`, the analyzer would still read `environment.ts`. Any decorator that reads a value from that file, like a template or a `providers` list built from an environment constant, would compile against the development file. The plugin gives both Vite and the analyzer the replacement's content, under the replaced file's name. The plugin's tests cover this with a component whose template comes from the environment file.

Two things differ from the CLI:

- **The replacement's relative imports resolve from the replaced file's directory.** If `environment.prod.ts` sits next to `environment.ts`, as it does in every CLI project, nothing changes. A replacement in another directory whose relative imports expect its own location would resolve them from the wrong place.
- **Errors and source maps name the replaced file**, `environment.ts`, even though its code is the replacement's.

In the dev server, an edit to the replacement reloads the page with the new content. An edit to the replaced file does nothing while the replacement applies.

For code you write from now on, consider Vite's own [env variables](https://vite.dev/guide/env-and-mode) instead. `import.meta.env.PROD` and `.env.production` files need no replacement at all.

## Budgets

`budgets` takes angular.json's array unchanged: every type (`initial`, `all`, `allScript`, `any`, `anyScript`, `bundle`, `anyComponentStyle`) and every threshold (`maximumWarning`, `maximumError`, `minimumWarning`, `minimumError`, `warning`, `error`, `baseline`). After `vite build`, failures print in the CLI's words:

```text
▲ [WARNING] bundle initial exceeded maximum budget. Budget 500.00 kB was not met by 6.26 kB with a total of 506.26 kB.
```

A warning leaves the build passing. An error fails it, after every failure has been printed, so CI scripts that check the exit code or grep for these lines keep working.

Sizes are of the files on disk, before compression, as with the CLI. Only the browser build is checked, and only `.js` and `.css` files count. Three things differ:

- **Inline styles are measured as written.** `anyComponentStyle` measures a `styleUrl` file as `ng build` does: compiled, then minified, before view encapsulation rewrites its selectors. In the repo's playground, `app.css` is 4,282 bytes as written and measures 3,339. Inline `styles` are different: ngp compiles them and ships them as written, so that's what they're measured at, and a long inline style can trip a budget that `ng build` wouldn't.
- **Bundle names are Vite's.** A `bundle` budget matches a chunk by its Rolldown name. Lazy chunks are named after their file, like `feature-detail`. The chunk holding `src/main.ts` also answers to `main`. Polyfills go into the entry chunk, so a `bundle` budget named `polyfills` measures nothing.
- **Initial means what index.html loads before your app runs**: the entry chunk, the chunks it imports statically, and their CSS. That's the CLI's meaning too, but Vite splits chunks differently, so expect a different total for the same app.

## Polyfills and zone.js

`polyfills` takes angular.json's array: package names like `zone.js`, or files in your project like `src/polyfills.ts`. The plugin imports them at the top of each entry module, so they run before Angular does, in the dev server, in the build and on the server.

A zoneless app, which is what `ng new` creates since Angular 21, needs nothing here. If your app still calls `provideZoneChangeDetection()`, list `zone.js`, and the plugin does what the CLI does:

- **On the server, `zone.js` becomes `zone.js/node`.** The server gets no other polyfills, except `@angular/localize/init`.
- **`async` and `await` are rewritten into generators.** zone.js can't see a native `await`, so the code after one runs outside Angular's zone and change detection never runs for it. In the plugin's test app, a component that sets a field after an `await` stays on "loading" forever without the rewrite. The CLI turns off esbuild's `async-await` support for zone.js apps, and the plugin uses esbuild with the same setting, on your code and on your dependencies. It costs little: 452 bytes and about 60 ms per build, on a 311 kB test app.

The plugin decides your app uses zone.js the way the CLI does: `zone.js` is in `polyfills`, or any polyfill is a file, since a file might import it.

One thing catches zone.js apps out on any build tool: in Angular 22.3, components are `OnPush` unless they say otherwise. A component that relies on zone.js to re-render after a plain field changes needs `changeDetection: ChangeDetectionStrategy.Eager`.

Under Vitest, the plugin imports no polyfills, because specs have no entry module, but it still rewrites `async` functions. A zone.js test setup imports `zone.js` and `zone.js/testing` in its setup file. See [Testing with Vitest](testing).

## Where every option goes

Every option of `@angular/build:application`, as of Angular 22.3:

| angular.json | With Vite and the plugin |
|---|---|
| `browser` | The `<script type="module" src="/src/main.ts">` in `index.html`. Set the plugin's `entries` if it isn't `src/main.ts` |
| `index` | `index.html` in Vite's root, usually your project root. The output is always `index.html` |
| `tsConfig` | The plugin's `tsconfig`. It defaults to `tsconfig.app.json` |
| `polyfills` | The plugin's [`polyfills`](migrating-from-ng-build#polyfills-and-zone-js) |
| `fileReplacements` | The plugin's [`fileReplacements`](migrating-from-ng-build#file-replacements) |
| `budgets` | The plugin's [`budgets`](migrating-from-ng-build#budgets) |
| `assets` | Vite's `public/` directory, which is what `ng new`'s default `{"glob": "**/*", "input": "public"}` copies. Other globs need a copy plugin |
| `styles` | `import './styles.css'` in `main.ts`, or a `<link rel="stylesheet" href="/src/styles.css">` in `index.html`. Vite compiles `.scss` once `sass` is installed |
| `scripts` | Put them in `public/` and add a plain `<script src>` to `index.html`. Vite leaves classic scripts as they are |
| `baseHref` | Vite's `base`, plus `<base href="%BASE_URL%">` in `index.html`. Vite fills in `%BASE_URL%` from `base` |
| `deployUrl` | Vite's `base`, or `experimental.renderBuiltUrl` for a CDN. The CLI deprecated it |
| `define` | Vite's `define`, in the same format: each value is a string of code |
| `sourceMap` | `build.sourcemap`: `true`, or `'hidden'` for `hidden`. Vite has no separate switch for vendor or style maps |
| `optimization` | On by default in `vite build`: Rolldown minifies, and the plugin runs the CLI's build optimizer. `styles.inlineCritical` and `fonts.inline` have no equivalent |
| `outputHashing` | Vite hashes every file name by default. `build.rolldownOptions.output` changes the patterns |
| `outputPath` | `build.outDir`. With the plugin's `ssr`, output goes to `<outDir>/client` and `<outDir>/server` |
| `deleteOutputPath` | `build.emptyOutDir` |
| `extractLicenses` | `build.license`, which writes `.vite/license.md` instead of `3rdpartylicenses.txt` |
| `namedChunks` | Vite names chunks after their file by default |
| `externalDependencies` | `build.rolldownOptions.external` |
| `allowedCommonJsDependencies` | Nothing: Vite doesn't warn about CommonJS dependencies |
| `loader` | Vite's `?raw` and `?url` import suffixes, and `assetsInclude` |
| `conditions` | `resolve.conditions` |
| `preserveSymlinks` | `resolve.preserveSymlinks` |
| `server`, `ssr` | The plugin's `ssr` option. See [Server rendering](server-rendering) |
| `aot` | Always on. The plugin has no JIT mode |
| `watch`, `poll` | The dev server watches by default. `server.watch.usePolling` for polling |
| `progress`, `verbose`, `clearScreen` | Vite's `logLevel` and `clearScreen` |
| `crossOrigin` | Vite adds `crossorigin` to the module scripts it injects |
| `webWorkerTsConfig` | Vite's `new Worker(new URL('./app.worker.ts', import.meta.url), {type: 'module'})`. Untested with the plugin |
| `statsJson` | No equivalent. `build.manifest` lists the chunks; a bundle visualizer plugin shows their contents |
| `stylePreprocessorOptions` | Vite's `css.preprocessorOptions`, for example `scss: {loadPaths: ['src/styles']}`. `styleUrl` files go through Vite's CSS pipeline. See [Component styles](styles) |
| `inlineStyleLanguage` | Not supported: inline `styles` are plain CSS, because ngp compiles them. Move preprocessed styles to a `styleUrl` file |
| `localize`, `i18nMissingTranslation` | The plugin's `i18n` option: `locales` names the locales to build, `missingTranslation` replaces `i18nMissingTranslation`. See [Internationalization](i18n) |
| `i18nDuplicateTranslation` | No equivalent. A message id that appears twice in one translation file is an error. When a locale has several files, the last file's translation wins, with no warning |
| `prerender`, `appShell`, `outputMode` | Not supported. Prerender with a script that calls your `render` function; this docs site does that |
| `serviceWorker` | Not supported. `ngsw-config` from `@angular/service-worker` can generate the manifest from the built output, but that's untested here |
| `subresourceIntegrity` | Not supported |
| `security` (`autoCsp`) | Not supported |

The CLI also reads `.browserslistrc` for its syntax target. Vite doesn't: set `build.target` yourself if you support older browsers than Vite's default, which is the "widely available" Baseline.

## Can't move yet

If your production build relies on any of these, it can't move to the plugin today:

- **Prerendering and `@angular/ssr`.** Route render modes, `AngularNodeAppEngine`, the app shell. Server rendering works through the plugin's own [`render` contract](server-rendering).
- **Sass, Less or other preprocessors in inline `styles`.** `styleUrl` files and global styles are fine: Vite compiles those.
- **The service worker.** `@angular/service-worker`'s manifest isn't generated.
- **Critical CSS inlining, subresource integrity and `autoCsp`.**
- **A library project.** `ng build my-lib` runs ng-packagr, and the plugin doesn't replace it: it compiles apps, and a library an app imports compiles with the app. Keep ng-packagr for a library you publish. See [Buildable and publishable libraries](nx#buildable-and-publishable-libraries).

[Status and limits](status) has the full list of what the plugin doesn't do yet, beyond build options.
