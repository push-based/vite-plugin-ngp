---
title: Migrating inside an Nx workspace
description: How to move one Angular app of an Nx workspace to vite-plugin-ngp while the rest stays on Nx, with its libraries compiled from source, and why buildable libraries stay on ng-packagr.
---

# Migrating inside an Nx workspace

You have an Nx workspace: an Angular app under `apps/`, libraries under `libs/` that it imports through the path aliases in `tsconfig.base.json`, and `nx serve` and `nx build` running `@nx/angular`'s executors. You want that one app on Vite with this plugin, while the other projects stay where they are. That works, and this page says what it takes. Everything on it was checked on [Ghostfolio](https://github.com/ghostfolio/ghostfolio), an Nx 23 workspace with two Angular libraries and 13 locales, which the [Benchmarks](benchmarks) page measures. The config the bench wrote for it is in the repo, at `bench/real/ghostfolio/vite.config.ngp.mjs`.

Read [Migrating from ng build](migrating-from-ng-build) first. `@nx/angular:application` and `@nx/angular:browser-esbuild` take the same options as `ng build`, so that page's table says where each option in `project.json` goes. This page covers what a workspace adds: one app among several, libraries as source, and Nx's targets. The plugin reads neither `project.json` nor `nx.json`, so both toolchains can run on the same sources while you compare.

## Vite's root is the app's folder

Vite starts from `index.html`. In a workspace with several apps, that file can't sit at the workspace root, so put it in the app's folder and make that folder Vite's root. The config lives next to it:

```ts title="apps/client/vite.config.mts"
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

const app = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(app, '../..');

export default defineConfig(({mode}) => ({
  root: app,
  cacheDir: path.join(workspace, 'node_modules/.vite/client'),
  build: {outDir: path.join(workspace, 'dist/apps/client')},
  resolve: {alias: tsconfigPathsAlias(path.join(workspace, 'tsconfig.base.json'))},
  oxc: {decorator: {legacy: true, emitDecoratorMetadata: false}},
  plugins: [
    ngp({
      tsconfig: 'tsconfig.app.json',
      entries: ['src/main.ts'],
      polyfills: ['src/polyfills.ts'],
      fileReplacements:
        mode === 'production' ? [{replace: 'src/environments/environment.ts', with: 'src/environments/environment.prod.ts'}] : [],
    }),
  ],
}));
```

Every path the plugin takes is relative to Vite's root, so `tsconfig`, `entries`, `polyfills` and `fileReplacements` are the app's own paths, without `apps/client/`. The workspace root appears only for the cache and output directories, so two apps never share them, and for the aliases, which the next section explains. `toolchain` is left out because the npm package carries its own ngp build ([Getting started](getting-started#2-add-the-plugin-to-vite)). `oxc.decorator` is explained under [Libraries compile with the app](nx#libraries-compile-with-the-app).

`index.html` is the app's own, with the `styles` list from `project.json` as `<link>` tags and the entry as a module script, the way [Getting started](getting-started#3-point-vite-at-your-app) describes. A stylesheet from a package, like Ghostfolio's `node_modules/open-color/open-color.css`, is simpler as an `import 'open-color/open-color.css'` in `main.ts`, where Vite resolves the package.

The dev server serves `libs/` and `node_modules` from above its root. On Ghostfolio it did that without configuration; if yours answers a file under `libs/` with a 403, Vite didn't recognize the workspace, and `server.fs.allow: [workspace]` tells it.

The bench runs Ghostfolio the other way, with `index.html` and Vite's root at the workspace root and `apps/client/src/main.ts` in every path, because the bench's harness wants one layout for every app. Both layouts were checked on the same app, the dev server and `vite build`: with the root at `apps/client`, the entry, an app component and a component from `libs/ui` all came back compiled, and the build wrote the app in 5.5 seconds with type-checking and i18n off.

## tsconfig paths become aliases

`tsconfig.base.json` maps `@myorg/ui` or `@myorg/ui/*` to folders under `libs/`. ngp's analyzer honours those, because it reads your tsconfig. Vite doesn't read tsconfig: it resolves imports as Node does, so it would look for `@myorg/ui` in `node_modules` and fail. Turn `paths` into `resolve.alias`. This is the function the bench uses:

```ts
/** tsconfig `paths` as Vite aliases: `@x/*` becomes a regex alias, an exact name a plain one. */
function tsconfigPathsAlias(tsconfigFile: string) {
  const {compilerOptions} = JSON.parse(fs.readFileSync(tsconfigFile, 'utf8'));
  const base = path.dirname(tsconfigFile);
  return Object.entries(compilerOptions.paths as Record<string, string[]>).map(([from, [to]]) => {
    const target = path.resolve(base, to);
    return from.endsWith('/*')
      ? {find: new RegExp(`^${from.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.*)$`), replacement: `${target.slice(0, -2)}/$1`}
      : {find: from, replacement: target};
  });
}
```

It takes each path's first target only, which is all an Nx workspace writes, and it ignores `baseUrl`. A package like `vite-tsconfig-paths` does the same job from npm; it hasn't been tried with the plugin.

## Libraries compile with the app

A library the app reaches through an alias is source to the plugin, like any file under `apps/client/src`: ngp compiles each of its files when the browser asks for it, a template edit in it updates the page in place, and `vite build` bundles what the app imports from it. That's what `nx build` does with a library that isn't buildable, so for the common case nothing changes. Three things do:

- **The app's tsconfig applies to the library's files.** The plugin reads one tsconfig, the app's, and its `angularCompilerOptions` decide how every file compiles, the library's `tsconfig.lib.json` included. `nx build` does the same, since the library's files are part of the app's program; only `nx build my-lib` reads `tsconfig.lib.json`.
- **A re-export of a type has to say `export type`.** A per-file compiler can't tell that `export {SomeInterface} from './x'` names a type. It compiles to a runtime re-export of nothing, and Rolldown stops the build with "missing export". TypeScript's `isolatedModules` check reports these as TS1205, and its quick fix writes the `export type`. Ghostfolio had one, in `libs/common`. `nx build` has the whole program and never hits this.
- **Decorator metadata has to be off.** Nx workspaces carry `emitDecoratorMetadata: true` in `tsconfig.base.json`, left over from when Angular needed it. Vite's per-file transform honours it and emits `design:paramtypes` naming each constructor parameter's type at runtime; a type that's an interface then survives as an import of nothing, and the module fails to load. `nx build` has the whole program and writes `Object` for those. Angular needs no decorator metadata, so the config above turns it off for Vite with `oxc.decorator`. Dropping the option from `tsconfig.base.json` works too, unless another project in the workspace needs it; a NestJS API does. TypeScript's own check for this is TS1272.

## Buildable and publishable libraries

Nx can also build a library on its own: `@nx/angular:package` runs ng-packagr and writes an Angular Package Format bundle to `dist/libs/<name>`, and `@nx/angular:ng-packagr-lite` does a lighter version of that for incremental builds. The plugin replaces neither. It compiles apps, and it has nothing that writes a library: no `.d.ts` files, no partially compiled `ɵɵngDeclare` output, no FESM bundle. Those come from ngc in partial compilation mode, which is what ng-packagr runs; the plugin only uses ngp's optimize mode, which compiles an app. [Decision 55](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/decisions.md#55-compile-apps-not-libraries) has the reasoning.

What to do depends on why the library is buildable:

- **To publish it.** Keep `nx build my-lib`. ng-packagr publishes a version next to every Angular version, but it can lag: its newest prerelease is `22.3.0-next.3` where the plugin pins `22.3.0-next.4`, so a library build runs ng-packagr one prerelease behind the compiler it loads from your app. That's as far as it was checked: nobody has run it in this repo.
- **For incremental builds, so the app doesn't recompile it.** Point the alias at the library's source, `libs/<name>/src/index.ts`, instead of `dist/libs/<name>`. The plugin compiles a file when it's asked for, so there's nothing to gain from building the library ahead of the app, and an edit in the library updates the page in place instead of waiting for `nx build my-lib`.
- **To consume it built, from `dist/`.** Untested. It should work: the plugin's linker runs on any JavaScript module that contains partially compiled declarations, wherever it lives, in builds and in the dev server's transform. What's untested is whether Vite's dependency pre-bundling in the dev server sees an aliased `dist/` folder, which decides whether the library is linked once at startup or per module.

## Nx targets

`@nx/vite` has executors, `@nx/vite:dev-server` and `@nx/vite:build`, and a plugin that infers `serve` and `build` targets from a `vite.config` file. Neither was tried with the plugin; the bench runs Vite's CLI directly. The plain way, which needs nothing installed:

```json title="apps/client/project.json"
{
  "targets": {
    "serve": {
      "executor": "nx:run-commands",
      "options": {"command": "vite", "cwd": "apps/client"}
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {"command": "vite build", "cwd": "apps/client"},
      "outputs": ["{workspaceRoot}/dist/apps/client"]
    }
  }
}
```

Keep the `@nx/angular` targets under other names while you compare the two. The plugin doesn't read `project.json`, so nothing in it conflicts.

Nx's test target runs Jest by default, and the plugin has nothing for Jest. [Testing with Vitest](testing) says how to run specs under Vitest. Under Vitest the plugin reads `tsconfig.spec.json` first, and in an Nx workspace that file lists Jest's types, so point `tsconfig` at one that doesn't. Ghostfolio's specs weren't run.

## What Ghostfolio needed

The whole list, from `project.json` to the bench's config:

| In `project.json` | With the plugin |
|---|---|
| `main`, `tsConfig`, `polyfills` | `entries`, `tsconfig`, `polyfills`, as app-relative paths |
| `fileReplacements` under `production` | `fileReplacements`, picked by Vite's `mode` |
| `budgets` | `budgets`, unchanged |
| `styles`, four files including one from `node_modules` | `<link>` tags in `index.html` |
| `i18n` block with 13 locales, `localize: true`, and one `development-<locale>` configuration per locale | The plugin's `i18n` option, with `sourceLocale`, `locales` mapping each code to its XLIFF file, and `devLocale` for the dev server. See [Internationalization](i18n) |
| `proxy.conf.json` on the serve target | `server.proxy` and `preview.proxy` |
| `serviceWorker: true`, `ngswConfigPath` | No option. The bench runs Angular's `ngsw-config` after the build; see [Migrating from ng build](migrating-from-ng-build#cant-move-yet) |
| `tsconfig.base.json`'s six `paths` | `resolve.alias`, from the function above |
| `emitDecoratorMetadata: true` | `oxc.decorator.emitDecoratorMetadata: false` |

Plus the two source patches the Benchmarks page describes: one `export type`, and `$any()` on two template expressions where ngp's type-check reports an error ngc's doesn't.

## Where it's weak

- **One workspace, two libraries, 157 components.** A workspace with fifty libraries, or one where apps import each other's code through aliases, hasn't been tried. The alias function handles what Nx writes and nothing more.
- **Nx's own Vite integration is untested.** `@nx/vite`'s executors and target inference may well work, since they run Vite with a config file, but nobody has checked, and Nx's cache needs `outputs` and `inputs` that the example above only starts on.
- **Libraries built with ng-packagr are out of scope.** A workspace that publishes libraries runs two toolchains, and the pinned prerelease of ng-packagr hasn't been run here.
