---
title: Status and limits
description: What vite-plugin-ngp does today, what it doesn't do yet, and where it's weakest.
---

# Status and limits

vite-plugin-ngp is a first version on top of a prototype compiler. This page says exactly what works and what doesn't, so you can decide whether your app can try it. Everything marked as working was checked in the repo's playground or on this site.

## What works

| Piece | Status |
|---|---|
| Per-module compilation | Works, in ngp's optimize mode, from the code Vite hands over |
| Adding, renaming and deleting files | Works. New files compile as they would in a fresh build. Deleting a file that's still used is an error until the file is back. Checked by an automated dev-server test |
| Edits in the dev server | Work. Template, stylesheet and inline style edits update in place; other edits reload the page |
| Production builds | Work, through the same transform, with the CLI's build optimizer. The playground's JavaScript is within 2% of `ng build`'s for the same app, and the same size gzipped |
| Linking Angular libraries | Works, in dependency pre-bundling and in builds, with Angular's Babel linker |
| Component HMR | Works for external templates, and for `.ts` edits that only change a component's inline `template` or `styles`. Other `.ts` edits reload, as under `ng serve`, and so does a template saved together with such a `.ts` edit. Changing `templateUrl` or `styleUrl` reloads too, unlike `ng serve` |
| Component stylesheets | `styleUrl` files go through Vite's CSS pipeline, so SCSS, Less and PostCSS work, with Angular's view encapsulation. Edits update in place, `ShadowDom` components included. See [Component styles](styles) |
| Build options from angular.json | `fileReplacements`, `budgets` and `polyfills` work, zone.js apps included. Every other option maps to Vite config; [Migrating from ng build](migrating-from-ng-build) lists each |
| Server rendering and hydration | Works in the dev server and in builds, with the `ssr` option. This site is prerendered that way |
| Internationalization | Works: `i18n` attributes and `$localize`, extraction with `ngp-extract-i18n`, and one translated folder per locale from a single build, with server rendering too. The playground ships English and German. See [Internationalization](i18n) |
| Vitest with TestBed | Works three ways, with zoneless TestBed: in Node on the server platform's DOM (Domino), so a passing component also renders on the server; on jsdom; and in Chromium through Vitest's browser mode. The playground runs its specs all three ways. A run compiles only the specs it runs and what they import. Watch mode reruns specs after template edits too. See [Testing with Vitest](testing) |
| Nx workspaces | Work, for one app at a time, with its libraries compiled from source through tsconfig paths turned into Vite aliases. Checked on Ghostfolio, an Nx 23 workspace with two Angular libraries, with Vite's root at the workspace root and at the app's folder. See [Migrating inside an Nx workspace](nx) |
| [Type-checking](type-checking) | Works, for templates and TypeScript, with TypeScript 7 in a separate process. Errors show in the dev server's terminal and overlay, and fail `vite build`. Planted errors land where `ng build` puts them. Checked on this site and the playground. At 5,000 components a planted error shows 1.36 s after the edit with `tsgo` and 1.02 s with tsrs ([Performance](performance#type-errors-in-the-dev-server)). Opt-in: the same check with tsrs, Oxc's Rust port of TypeScript 7, through `typeChecker: 'tsrs'` ([Checking with tsrs](type-checking#checking-with-tsrs)) |

## What doesn't work yet

| Piece | Status |
|---|---|
| Preprocessors in inline styles | Missing. Inline `styles` and template `<style>` elements are plain CSS, because ngp compiles them and has no preprocessing hook. There's no `inlineStyleLanguage` |
| HTTP status codes from SSR | Missing. `render` returns HTML only, so a not-found page answers 200 when a Node server renders it |
| Prerendering, the service worker, critical CSS inlining, subresource integrity, `autoCsp` | Not supported. [Migrating from ng build](migrating-from-ng-build#cant-move-yet) lists what an `ng build` app can't bring along |
| Library builds | Not supported. The plugin compiles apps, and writes no `.d.ts` files, partially compiled output or Angular Package Format bundle. A library you publish keeps ng-packagr through `ng build` or `nx build`. See [Buildable and publishable libraries](nx#buildable-and-publishable-libraries) |
| Vitest beyond those | Untried: happy-dom, browser mode on Firefox and WebKit, coverage. `fakeAsync` needs `zone.js`, which the documented setup leaves out |
| Windows | Untested. The package has no native engine for it, and nobody has tried `engine: 'wasm'` there. WSL 2 is Linux, so it gets the native engine |

## Where it's weakest

- **ngp is a prototype, and the plugin uses it as one.** ngp's API isn't public, and the plugin reaches below it in two places to skip work it doesn't need. Any Angular commit can break that, which is why every Angular package is pinned to exactly `22.3.0-next.4`.
- **The ngp in the package is an unofficial build.** `@push-based/vite-plugin-ngp` carries ngp built from Angular's source, not a release from the Angular team, with native engines for macOS and for glibc Linux on x64 and arm64. Everywhere else, Alpine included, it needs `engine: 'wasm'`, which analyzes up to twice as slowly. Each plugin version carries one ngp build, so moving to another Angular commit means a new plugin release.
- **File changes are tested on one small app.** Adding, renaming and deleting components and templates is covered by a test on a three-component app, not on a large one. Deleting a component that's still used gives Angular's "is not a known element" error, which names the element, not the missing file. A missing `styleUrl` file isn't reported at all.
- **Type-checking is whole-program.** Every check runs TypeScript 7 over the whole app. That takes 100–250 ms in the dev server on the repo's playground. On a 5,000-component app, an error shows up 1.45 s after the edit, a little sooner than under `ng serve`. See [Type-checking](type-checking#where-its-weak).
- **SSR runs two analyzers.** The browser and the server each get their own ngp compiler, because only the browser's has HMR code. A dev server with SSR needs about twice the analyzer memory, and analyzes every edit twice.
- **Component stylesheets take two paths.** The dev server serves them as `<link>`s, and builds inline them into the JavaScript, as the CLI does. Both are tested, but a bug can show in only one.
- **The build optimizer is a copy of the CLI's.** When `@angular/build` changes its pass, the plugin keeps the old one until someone ports the change. Nothing fails when that happens; only bundle sizes would show it.
- **The `ng build` options copy the CLI's rules.** Budgets, the zone.js check and the server's polyfills are ported by hand from `@angular/build`. If the CLI changes them, the plugin keeps the old ones. Inline `styles` are measured unminified for `anyComponentStyle`, so they come out larger than under `ng build`.
- **i18n has one app behind it.** Extraction, translation and per-locale builds are checked on the playground's two locales and 34 messages. Formats other than XLIFF 1.2 were extracted, not translated from. An ICU message inside `@if` inside `@for` fails Angular's i18n hydration, which ngc's output does too.
- **The linker is the slow one.** It's the Babel-based linker. The Angular CLI has since moved to a faster oxc-based one, which the plugin can't use yet because it's private to `@angular/build`.

## What has been measured, and what hasn't

The [Performance](performance) page measures the plugin's dev server and builds against `ng serve`, Analog and `@oxc-angular/vite`, on generated apps of 100 to 5,000 components and the playground, on one laptop. [Benchmarks on real apps](benchmarks) measures it against the Angular CLI on Super Productivity and against Nx on Ghostfolio, for time and memory, on GitHub's Ubuntu runners and on the same laptop. Still unmeasured:

- **Large real apps.** The two real apps have 252 and 157 components. An enterprise app with a thousand components and 50 libraries hasn't been tried, and the plugin's cold start grows with the number of packages the Babel linker has to process.
- **Windows.** Every number is from macOS or Ubuntu. Nobody has run the plugin on Windows itself, or timed it under WSL 2.
- **How far apart one save writes its files.** The plugin holds a template update until 50 ms after the template was written, in case the same save changes the component's class. That 50 ms is a guess, and it's why the fastest template edit takes about 60 ms in the plugin against about 16 ms in `@oxc-angular/vite`. See [Performance](performance#template-edits).
- **Where the cold start's memory goes on a large real app.** On the two real apps the plugin's dev server holds 0.9–1.7 GB after a restart, where the CLIs hold 3.5–3.7 GB, and on the generated 5,000-component app 1.0 GB against `ng serve`'s 6.0 GB ([Performance](performance#memory)). But its cold start of Super Productivity peaks at 4.9 GB on a 4-core runner, above `ng serve`'s 3.6 GB, and which of the three processes that run then, Vite's pre-bundling, `tsgo` or typia's program, holds most of it hasn't been measured.
