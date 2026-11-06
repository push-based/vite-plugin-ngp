---
title: How it works
description: What vite-plugin-ngp does between Vite's request for a module and the compiled Angular code it returns.
---

# How it works

Every dev server built on Angular's compiler compiles your whole program before it serves a single module. vite-plugin-ngp compiles each file when Vite asks for it, and only that file. This page explains how, for anyone who wants to know what the plugin does before trusting it with an app.

## Why per-module compilation was impossible before

ngc, the compiler behind `ng serve` and `ng build`, can't compile one file until it has built a TypeScript program of the whole project and analyzed every decorator in it. So every tool built on ngc works around Vite instead of with it. `ng serve` runs esbuild and uses Vite only to serve the output. `@analogjs/vite-plugin-angular` compiles the program up front and ignores the code Vite passes to its transform. [Compared with alternatives](comparison) puts the two next to Analog's per-file `fastCompile` and `@oxc-angular/vite`.

ngp, which Angular merged on 8 October 2026, splits the compiler in two. A Rust analyzer, built on [oxc](https://oxc.rs), reads decorators and resolves references across files, and it answers per file, on demand. Angular's existing template compiler, in TypeScript, then generates the code. For each file ngp returns plain TypeScript with the decorators compiled away, which is exactly what a Vite transform should return.

## Compiling one module

When the browser asks for a `.ts` file, Vite hands its code to the plugin's `transform` hook. The plugin runs before Vite's own TypeScript transform, and it:

1. Tells the analyzer about the code, if it differs from what the analyzer last saw. Another plugin may have changed it on the way. Code Vite read before your latest save is left out, as the next section explains.
2. Calls ngp's `processFile` for that one file, in optimize mode.
3. Returns ngp's TypeScript and a source map. Vite's transform then strips the types, as it does for any TypeScript file.

Files without Angular decorators come back unchanged. One compiler lives as long as the dev server, so nothing is analyzed twice.

The plugin always uses ngp's **optimize mode**, in development and in production. ngp's other mode, local, compiled 745 of 1,089 modules differently when they were compiled one at a time: components lost `ChangeDetectionStrategy.OnPush`, which changes how an app behaves at runtime. Optimize mode matched a full build for every module.

## Handling an edit

When a file changes, the plugin sends the new content to the analyzer. The analyzer answers with every file whose output may have changed. The plugin drops those files from ngp's cache and invalidates them in Vite's module graph. Vite then asks again for the ones the page still uses.

Adding, renaming and deleting files works the same way. The analyzer finds a new file through the import that adds it. When you delete a file, the plugin tells the analyzer it's gone and recompiles everything that imports it. An importer that still uses the file fails with an error, and recovers when the file is back. If a component's `templateUrl` points at a file that doesn't exist, the plugin reports `NG2008: Could not find template file`, as `ng build` would. ngp on its own would compile it to an empty template.

The Angular CLI's path runs a "delta" pass after each edit, which streams every file in the program again: 465 ms at 5,000 components. The plugin skips it, because Vite's module graph already knows which modules the page still uses.

A transform can carry code from before a save: Vite read the module, you saved, and only then did the transform run. Sending that code to the analyzer would undo your save for every component compiled before the file's next transform. So the plugin notes when Vite read each module, and a transform of a module read before the latest edit leaves the analyzer alone, unless its code is what's on disk now. Vite throws that transform's result away anyway, because your save invalidated the module while it ran, and compiles it again.

### Keeping edits cheap in large apps

After every update, ngp's analyzer reloads its tsconfig and walks the whole source tree to re-expand the `include` globs. At 5,000 components that made a one-line edit cost 172 ms. So the plugin gives the analyzer a generated tsconfig that extends yours and lists only the entry points. The analyzer finds every other file by following imports, and the same edit costs about 1 ms, with identical output. Turn this off with [`entryOnlyTsconfig: false`](configuration).

## Component HMR

In the dev server, ngp compiles each component with the same HMR code the Angular CLI's compiler adds. When you edit a component's external template, or only the inline `template` or `styles` in its `.ts` file:

1. The plugin asks ngp for that component's update module, strips its types, and stores it.
2. It sends `angular:component-update` over Vite's HMR channel.
3. Angular's runtime fetches the update from `/@ng/component?c=<id>`, which the plugin serves, and swaps the new template into the running component.

The component keeps its state: a counter at 2 stays at 2 while its heading changes. If the runtime can't apply an update, it says so, and the plugin reloads the page.

For a `.ts` edit, the plugin decides with the same rules as the Angular CLI's dev server. It compares the file before and after the edit, as text. If the only difference is inside the `template` or `styles` value of a component's decorator, those components update in place. In a file with several components, only the ones you edited update. Any other difference reloads the page: a new entry in `imports`, a changed `selector`, an input, a method, an import or a constant at the top of the file. An update can't bring in code the running page doesn't have yet, so those need the reload.

The comparison is strict, and that's deliberate. It doesn't try to tell a harmless change from a real one, so reformatting a method reloads too. Two cases update in place under `ng serve` and reload here: a template kept in a constant outside the decorator, which is a top-level change, and an edit to `templateUrl` or `styleUrl`.

If one save changes both a component's template and its `.ts` file, and the `.ts` change needs a reload, the page reloads once, without trying the template update first. The new template may use a field the running class doesn't have yet. If the `.ts` change only touched inline templates or styles, both update in place. The plugin holds a template update until 50 ms after the template was written, by its modification time, to see whether the `.ts` file changed too. On macOS, Vite's watcher usually reports a write about 110 ms after it, so the 50 ms has passed by then and the update goes out at once. When the watcher reports within about 10 ms, the update waits out the remaining 40 ms. It then compares the class the page last loaded with the latest one on disk, so it doesn't matter in which order, or how far apart, the watcher reports the two files.

## Component stylesheets

ngp compiles with `externalRuntimeStyles`, so it leaves `styleUrl` files out of the component and lists their paths instead. The plugin hands those files to Vite's CSS pipeline, which runs Sass and PostCSS on them like on any stylesheet, and then applies Angular's view encapsulation to Vite's output with Angular's own code.

In the dev server, each stylesheet is a `<link>` the runtime adds, and an edit reloads only that `<link>`, so the component keeps its state. In builds, each stylesheet is compiled, scoped and inlined into the component's JavaScript. Inline `styles` stay with ngp and can't use Sass. [Component styles](styles) has the details and the differences from the CLI.

## Type-checking

Compiling a module doesn't check its types. Separately, after startup and after each edit, the plugin asks ngp for a type-check block per component file, and runs TypeScript 7 over your app and those blocks in another process. It maps errors in a block back to your template. Angular's extended diagnostics, the NG81xx template checks, do come out of the compile itself, as warnings. [Type-checking](type-checking) has the details.

## Linking libraries

Angular libraries, Angular's own packages included, ship partially compiled: `ɵɵngDeclareComponent(...)` calls that describe a component without being its runtime code. The linker rewrites them into the final code for your Angular version, as the CLI does. ngp only compiles your own sources, so the plugin runs Angular's linker on every module in `node_modules` that needs it:

- In development, inside Vite's dependency pre-bundling, which runs outside the normal plugin pipeline. With `ssr`, the server's libraries are pre-bundled too, into `node_modules/.vite/deps_ssr`; see [Server rendering](server-rendering#what-the-plugin-does).
- In production builds and server bundles, in the normal transform. On the server, the plugin bundles every Angular library it finds in your `dependencies`, so the linker sees them too.
- Under Vitest, in the normal transform. The plugin has Vitest inline every Angular library instead of leaving it to Node, so the linker sees them. See [Testing with Vitest](testing).

Without a linker, the browser would need Angular's JIT compiler to finish compiling libraries at startup. In the playground, linking cut the production bundle from 1,197 kB to 589 kB.

## Compile-time globals

The plugin defines the same globals the Angular CLI does, so the minifier can drop code your build doesn't need:

| Global | Value |
|---|---|
| `ngJitMode` | `false` everywhere, since the linker makes every library ahead-of-time compiled |
| `ngDevMode` | `false` in builds |
| `ngServerMode` | `false` in the browser, `true` in server environments |
| `ngHmrMode` | `true` in the dev server's browser environment, `false` under Vitest |
| `ngI18nClosureMode` | `false` everywhere, so i18n messages compile to `$localize` calls, never Closure's `goog.getMsg` |

These took the playground's bundle from 589 kB to 386 kB, and stopped production builds from logging "Angular is running in development mode".

## Build options from angular.json

Three angular.json options need the plugin, not just Vite. The [migration guide](migrating-from-ng-build) says how to use them. This is what they do inside.

**File replacements reach the analyzer.** ngp's analyzer reads files from disk by following imports, so it would never see a replacement that only Vite knows about. When the plugin starts a compiler, it sends the analyzer each replacement's content under the replaced file's path, before anything compiles. Vite's `load` hook returns the same content for the same path. Both see one file, with the replacement's code, so a component whose template comes from `environment.ts` compiles with the production template. The analyzer only learns about the replacement from the plugin: from the watcher when you edit it, never from a transform, which can carry code read just before your edit.

**Polyfills are the entry's first imports.** The plugin puts one import per polyfill at the top of `src/main.ts` and of your server entry. On the server, `zone.js` becomes `zone.js/node`.

**zone.js apps get their `async` functions rewritten.** Code after a native `await` runs outside zone.js's view, so Angular never runs change detection for it. Like the CLI, the plugin rewrites `async` functions into generators with esbuild for zone.js apps, and leaves every other modern feature alone. Builds rewrite each output chunk once. The dev server rewrites each module that contains `async` as it serves it, dependencies included.

## The build optimizer

`vite build` runs one more pass over your code and your libraries, which the dev server skips: Angular's build optimizer, the same rewrites `ng build` makes. Despite the name, it has nothing to do with ngp's optimize mode. It exists because the bundler can only drop code it knows is safe to drop, and Angular's compiled output doesn't say which code that is. A component's `static ɵcmp = ɵɵdefineComponent(...)` is a function call, so without help Rolldown keeps every component, pipe and service it has seen, whether your app uses it or not.

The plugin's pass is a port of the CLI's, and makes the same changes:

- A class with Angular's static definitions (`ɵcmp`, `ɵfac`, `ɵprov` and the rest) moves into a function marked `/*#__PURE__*/`. If nothing uses the class, Rolldown drops it with its definition.
- In Angular's own packages, which declare `"sideEffects": false`, every top-level call and `new` is marked pure. In your code and in other libraries, only `new InjectionToken(...)` is.
- TypeScript enums move into a pure function too, and `forwardRef(...)` calls count as pure.
- `ɵsetClassMetadata` calls and JIT-only decorator metadata are removed. With `ngDevMode` set to `false` the minifier drops those anyway, so this changes nothing you'd notice.

Measured on the repo's playground, with the same script for each build (raw size, gzip in brackets):

| | JavaScript on the first page | All JavaScript |
|---|---|---|
| Before the optimizer | 502 kB (158 kB) | 552 kB (179 kB) |
| With it | 316 kB (99 kB) | 390 kB (129 kB) |
| `ng build` of the same app | 336 kB (109 kB) | 383 kB (129 kB) |

On this site, the first page's JavaScript went from 462 kB to 298 kB (143 kB to 93 kB gzipped). Taken as a whole, the plugin's output is now as big as `ng build`'s for the same app: 2% larger raw, the same size gzipped. The first page is smaller than `ng build`'s only because Rolldown splits chunks differently from esbuild.

The pass trusts what the CLI trusts: that no top-level code in Angular's packages runs for its side effects. And it's a copy, so when the CLI changes its pass, the plugin's stays as it was until someone ports the change.
