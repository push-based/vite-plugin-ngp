---
title: Configuration
description: Every option vite-plugin-ngp accepts, its default, and when to change it.
---

# Configuration

`ngp()` takes one options object. The package from npm needs none of them, because it carries its own ngp build ([Getting started](getting-started)).

```ts
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [
    ngp({
      engine: 'native',
      tsconfig: 'tsconfig.app.json',
      entries: ['src/main.ts'],
      entryOnlyTsconfig: true,
      hmr: true,
      ssr: false,
      typeCheck: true,
      fileReplacements: [],
      budgets: [],
      polyfills: [],
    }),
  ],
});
```

## Options

| Option | Type, default | What it does |
|---|---|---|
| `toolchain` | `string`<br>Default: the `NGP_TOOLCHAIN` variable, then the ngp build inside the package | A directory holding another ngp build, `preprocessor/` and `engines/`. Leave it unset: the package carries ngp for macOS (arm64 and x64) and Linux (x64 and arm64, glibc), and uses it when neither this nor the variable is set. You need it only to run a build of ngp you made yourself, from a different Angular commit. |
| `engine` | `'native' \| 'wasm'`<br>Default `'native'` | Which build of ngp's analyzer to load: the native Node addon, or `'wasm'`. There's no automatic fallback: on a platform the package has no native engine for, the plugin stops and says to set `'wasm'`. Any other value, such as a misspelled `'natve'`, is an error at startup. |
| `tsconfig` | `string`<br>Default `tsconfig.app.json`, else `tsconfig.json`. Under Vitest, `tsconfig.spec.json` first | The tsconfig your Angular compiler options come from, relative to Vite's root. |
| `entries` | `string[]`<br>Default `src/main.ts`, plus `src/main.server.ts` if it exists. Under Vitest, none | The modules the analyzer starts from. It finds every other file by following imports. |
| `entryOnlyTsconfig` | `boolean`<br>Default `true` | Give the analyzer a generated tsconfig that lists only `entries`. |
| `hmr` | `boolean`<br>Default `true` | Component HMR in the dev server, for external templates and for inline `template` and `styles` edits. Builds and Vitest ignore it. |
| `i18n` | `I18nOptions`<br>Off by default | Angular i18n: `sourceLocale`, `locales`, `devLocale` and `missingTranslation`. `vite build` writes one translated folder per locale, and the dev server serves `devLocale`. See [Internationalization](i18n). |
| `ssr` | `boolean \| {entry?: string}`<br>Default `false` | Server rendering. `true` uses `src/main.server.ts` as the server entry, and `{entry: 'path'}` names another. Vitest ignores it. See [Server rendering](server-rendering). |
| `typeCheck` | `boolean`<br>Default `true`, except under Vitest | Type-check templates and TypeScript with TypeScript 7, in a separate process. The dev server reports errors in the terminal and the overlay, and `vite build` fails on them. See [Type-checking](type-checking). |
| `typeChecker` | `'tsgo' \| 'tsrs'`<br>Default `'tsgo'` | Which TypeScript 7 runs the check: `tsgo`, Microsoft's Go port, which the plugin installs, or `tsrs`, Oxc's Rust port, which you install yourself. See [Checking with tsrs](type-checking#checking-with-tsrs). |
| `fileReplacements` | `{replace: string; with: string}[]`<br>Default `[]` | angular.json's `fileReplacements`, relative to Vite's root. Every import of `replace` gets the content of `with`, in Vite and in ngp's analyzer, in dev and in builds. |
| `budgets` | `Budget[]`<br>Default `[]` | angular.json's `budgets`: size limits checked after `vite build`, with the CLI's types and messages. An error budget fails the build. |
| `polyfills` | `string[]`<br>Default `[]` | angular.json's `polyfills`: packages or files imported before your app. `zone.js` also makes the plugin rewrite `async`/`await` so zone.js can track it. |

## When to change them

**`engine: 'wasm'`** is for platforms without a native build: Alpine and other musl-based Linux, Linux on a CPU other than x64 or arm64, and Windows outside WSL. It works everywhere, but the analyzer runs single-threaded. On a real app it took up to twice as long as native, which is why the plugin never switches to it on its own.

**`entries`** needs every module that nothing else imports: a second entry point, or a server entry with another name. Files no entry reaches, directly or through imports, are invisible to the analyzer.

**`entryOnlyTsconfig: false`** makes the analyzer read your tsconfig as it is. Use it if a file the analyzer should see isn't reachable from `entries`. Expect edits to get slower as the app grows: about 172 ms per edit at 5,000 components, against 1 ms.

**`ssr: true`** renders every page on the server in the dev server, and makes `vite build` build two bundles: `dist/client` for the browser and `dist/server/main.server.js` for the server. The entry's default export must be `render(url, document)`.

**`typeCheck: false`** skips the check in the dev server and in builds. Use it if you already run `tsc` or `ng build` in CI and the dev-server check is too slow on your app, or if your `cacheDir` is outside the project. Builds then succeed with type errors in them.

**`typeChecker: 'tsrs'`** runs the same check with tsrs, a pre-1.0 Rust port of TypeScript 7, after `npm install -D tsrs`. On a 5,000-component app it reported a planted error in 1.12 s against `tsgo`'s 1.56 s; on a small app there's nothing to gain. No package for Intel Macs. See [Checking with tsrs](type-checking#checking-with-tsrs).

**`fileReplacements`** is for environment files. Pick the list by Vite's `mode`, the way angular.json picks it by configuration:

```ts
export default defineConfig(({mode}) => ({
  plugins: [
    ngp({
      fileReplacements:
        mode === 'production' ? [{replace: 'src/environments/environment.ts', with: 'src/environments/environment.prod.ts'}] : [],
    }),
  ],
}));
```

The replacement's relative imports resolve from the replaced file's directory, unlike under the CLI. [Migrating from ng build](migrating-from-ng-build#file-replacements) explains why.

**`budgets`** takes angular.json's array as it is. These are the ones `ng new` generates:

```ts
ngp({
  budgets: [
    {type: 'initial', maximumWarning: '500kB', maximumError: '1MB'},
    {type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB'},
  ],
});
```

`styleUrl` files are measured as `ng build` measures them, minified. Inline `styles` are measured as written, so they come out larger. See [Budgets](migrating-from-ng-build#budgets).

**`polyfills`** is only needed for apps that still run on zone.js, and for polyfill packages:

```ts
ngp({polyfills: ['zone.js']});
```

On the server, `zone.js` becomes `zone.js/node`. A zoneless app, which is what `ng new` creates since Angular 21, leaves this empty. See [Polyfills and zone.js](migrating-from-ng-build#polyfills-and-zone-js).

**`i18n`** is for apps with translated text. `locales` maps each locale code to its translation file, for example `{de: 'src/locale/messages.de.xlf'}`. Leave it out while the app has a single language: without it, a `$localize` message needs `@angular/localize/init` imported by the app, as with the CLI.

**`hmr: false`** makes every edit reload the page. Use it if an in-place update ever leaves a component in a broken state, and tell the maintainers at [PushBased](https://push-based.io/) what you edited, so the rule that let it through can be fixed.

## What the plugin sets for you

You don't configure these, but they explain what you see when you debug:

- `define`: `ngJitMode`, `ngDevMode`, `ngServerMode`, `ngHmrMode` and `ngI18nClosureMode`, as [How it works](how-it-works) lists.
- `optimizeDeps.rolldownOptions.plugins`: Angular's linker, for dependency pre-bundling.
- With `ssr`, in the dev server: `optimizeDeps` for the `ssr` environment, with discovery on, so the server's Angular libraries are pre-bundled and linked once into `node_modules/.vite/deps_ssr`. Its Rolldown plugins keep everything that isn't an Angular library out of the bundle, bake the server's `define` values in, and delete the bundle's source maps. See [Server rendering](server-rendering#what-the-plugin-does).
- `build.rolldownOptions.treeshake.manualPureFunctions`: `forwardRef`, so unused `forwardRef(...)` calls can be dropped, as `ng build` does. The rest of the build optimizer is a transform and needs no configuration.
- `resolve.noExternal` in server environments: every `@angular/*` package, plus every package in your `dependencies` that depends on `@angular/core`, so Angular libraries get bundled and linked instead of loaded unlinked by Node. An Angular library under `devDependencies` stays external; add it to `resolve.noExternal` yourself.
- A dev-server middleware that answers `/@ng/component` requests with component updates.
- With `typeCheck`: a `vite-plugin-ngp/type-check` folder in Vite's cache directory, holding the type-check blocks, the check's tsconfig and its incremental build info. In the dev server, a script tag in `index.html` loads `/@ngp/type-check-client.js`, which shows type errors in Vite's overlay. It's left out when `server.hmr.overlay` is `false`.
- A resolver for component stylesheet names in the dev server, like `card.ngp-de07cd19.css`, and a transform that scopes component stylesheets after Vite's CSS plugin has compiled them. See [Component styles](styles).
- With `ssr`: `builder: {}` and output directories for the `client` and `ssr` environments, and a middleware that renders page requests through your server entry.
- Under Vitest, none of the above except the linker. Instead: `test.server.deps.inline` with every Angular library, from `devDependencies` too, so they get linked; a cache key generator that keeps your app's modules out of Vitest's module cache; and a watcher that sends edits to the analyzer, since Vitest turns Vite's HMR off. See [Testing with Vitest](testing).
- With `fileReplacements`: a `load` hook that returns the replacement's content for the replaced file, and watches the replacement.
- With `polyfills`: one import per polyfill at the top of each module in `entries`. With `zone.js`, a `transform` in the dev server and a `renderChunk` in builds that rewrite `async` functions with esbuild.
- With `budgets`: on the browser build, a `transform` that measures each component stylesheet after `vite:css`, and a `generateBundle` hook that checks the sizes and logs the CLI's messages.
- With `i18n`: any `@angular/localize` entry in `polyfills` is dropped. In the dev server: `optimizeDeps.include` with `@angular/localize`, its `init` entry and the dev locale's data, for the `ssr` environment too when `ssr` is on, and an import added to the top of each entry module that sets up `$localize`. In `vite build` and `vite preview`: `base: './'` and `build.copyPublicDir: false`, because the plugin writes every file below `<outDir>/<locale>/` itself, including the public directory. `vite preview` gets a middleware that serves each locale's `index.html` and redirects `/` to a locale. See [Internationalization](i18n).

To watch the plugin work, set `DEBUG=vite-plugin-ngp`. It logs every module ngp compiles, and how long each took, to stderr. For each template update it also logs how long each step took, from the watcher's report to sending the update:

```text
vite-plugin-ngp hmr src/app/home.ts: watcher 111.8, read 0.1, analyze 0.6, owner 0.0, stat 0.1, wait 0.2, class 0.1, emit 3.3, transform 0.5, send 0.1 ms
```

`watcher` is the time from the template's write to the watcher's report, `stat` reads the write's time, and `wait` is what was left of the 50 ms after it. See [How it works](how-it-works#component-hmr).
