---
title: Changelog
description: What changed in vite-plugin-ngp, newest first, for anyone following the prototype.
---

# Changelog

What changed in vite-plugin-ngp, newest first, written for people using it. Every entry links to the page that documents it. Versions on npm, with the commits in each, are in the repo's [CHANGELOG.md](https://github.com/push-based/vite-plugin-ngp/blob/main/CHANGELOG.md) and its [GitHub releases](https://github.com/push-based/vite-plugin-ngp/releases).

## 6 November 2026

### Testing

- The documented Vitest setup now runs specs in Node on the server platform: `environment: 'node'`, `@angular/platform-server/init` and `ServerTestingModule`. The DOM is Domino, the one Angular renders with on the server, so a component that passes its spec also renders on the server, and a warm run of the playground's 11 tests went from 1.1–1.3 s to 0.58–0.61 s without jsdom's window setup. Domino is smaller than jsdom: spread `querySelectorAll` results with `Array.from`, and dispatch `new Event(type)` rather than `new MouseEvent(type)`. jsdom is still documented as the alternative. [Testing with Vitest](testing#why-the-server-platform)

### Angular

- The plugin moved from Angular `22.3.0-next.2` to `22.3.0-next.4`, and the ngp it carries is built from the commit that release was cut at. Move every `@angular/*` package in your app with it: the pin is still exact, because ngp imports private APIs from `@angular/compiler-cli`. [Getting started](getting-started)

### Type-checking

- ngp now runs Angular's extended diagnostics, the NG81xx template checks `ng build` reports, so an uninvoked signal in an interpolation or a unitless CSS length is a warning in your terminal while the module compiles. They come out of the compile, not the type-check pass, so you get them with `typeCheck: false` too, and your tsconfig's `angularCompilerOptions.extendedDiagnostics` decides their severity. A check name or category that doesn't exist fails startup with Angular's message, instead of turning every extended check off in silence. [Type-checking](type-checking#angulars-extended-diagnostics)

### Dev server

- Restoring a file you deleted recovers again. The newer analyzer drops the edge from an importer to a file it's told was deleted, so a restored component stayed "not a known element" until the importer was edited; the plugin now tells the analyzer about created files and re-analyzes the importers itself. [How it works](how-it-works#handling-an-edit)

## 21 October 2026

### Packaging

- On npm: `npm install -D @push-based/vite-plugin-ngp`. 0.2.0 is the first version there, and it needs no `toolchain` option and no `pnpm toolchain`, because it carries its own ngp build. [Getting started](getting-started) now starts from npm; building ngp in a clone is for working on the plugin. [Status and limits](status#where-its-weakest)
- The Building ngp page and the playground's clone-and-build steps are gone from this site, since using the plugin no longer needs a Rust build. Building ngp to work on the plugin is in the repo's [docs/building.md](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/building.md). [Getting started](getting-started)
- The package is now named `@push-based/vite-plugin-ngp`, under the PushBased npm org like its other packages. Import the plugin with `import {ngp} from '@push-based/vite-plugin-ngp'`. If you installed it from a clone, run `pnpm install` again and change that one import in `vite.config.ts`; the plugin's options didn't change. [Getting started](getting-started)

## 20 October 2026

### Packaging

- The plugin's package now carries its own ngp build: ngp's backend, the wasm engine, and native engines for macOS (arm64, x64) and glibc Linux (x64, arm64). When neither `toolchain` nor `NGP_TOOLCHAIN` is set, the plugin loads that build, so a released copy needs no options and no `pnpm toolchain`. Nothing is on npm yet, so for now this changes nothing for a copy installed from a clone. [Configuration](configuration), [docs/building.md](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/building.md#the-build-inside-the-package)

## 19 October 2026

### Repo

- The repo is now [push-based/vite-plugin-ngp](https://github.com/push-based/vite-plugin-ngp), named after the plugin, and these docs moved to https://push-based.github.io/vite-plugin-ngp/. Old GitHub links redirect; links to the old docs address don't. A fresh clone lands in `vite-plugin-ngp/`, so the `toolchain` paths in [Getting started](getting-started) changed to match. If you cloned before, run `git remote set-url origin https://github.com/push-based/vite-plugin-ngp.git`.

### Docs site

- The [ngp benchmark](https://github.com/push-based/ng-hybrid-preprocessor-bench) is public, so its links on [Performance](performance), [Benchmarks](benchmarks) and [Comparison](comparison) work for everyone and no longer say "private repo". It has the generator behind the test apps, the methodology, and the audits the plugin's design started from.
- A new logo: an Angular "A" between two parentheses, inside a gear, in cyan to magenta. It's in the header, on the home page, as the favicon, and in the repo's README. The inside of the gear is transparent, so it looks the same on the light theme and the dark one.

## 18 October 2026

### Type-checking

- What the idle-triggered first check gains on a cold start is now measured on the generated 5,000-component app, with the plugin before and after the change started in the same rounds: first paint went from 1.84 s to 1.70 s, every sample of the old plugin slower than every sample of the new. A restart paints before the old one-second delay ever fired, and didn't move. [Type-checking](type-checking#where-its-weak)

### Docs

- The Performance page is remeasured on the plugin with the tsrs option merged and the first dev-server check waiting for an idle server: the four generated apps on the laptop, now with `typeChecker: 'tsrs'` as a row of its own in every table. tsrs shows a type error at 5,000 components in 1.02 s where `tsgo` takes 1.36 s, and takes about half a gigabyte off the dev server's peak during edits and off a production build's; starts, edits and build times are within the run-to-run drift with either. Every other number moved by a few percent either way. [Performance](performance)
- The Benchmarks page is remeasured too, on the same plugin: the two real apps on GitHub's runners and on the laptop. The change that shows is Super Productivity's cold start on a 4-core runner, 10.5 s against `ng serve`'s 17.4 where the morning's run had 21.4 against 23.1, at a peak of 3.0 GB instead of 4.9, now that the first type-check waits for an idle server; the runners were faster this time too, and the page says how much of the drop is which. [Benchmarks](benchmarks#starting-the-dev-server)

## 17 October 2026

### Type-checking

- New option `typeChecker: 'tsrs'` runs the type check with tsrs, Oxc's Rust port of TypeScript 7, instead of `tsgo`. You install `tsrs` yourself; the plugin hands it the same tsconfig and errors land in the same places. On the 5,000-component app a planted template error reaches the terminal in 1.12 s instead of 1.56 s, measured in one run; on the playground the two are even. [Checking with tsrs](type-checking#checking-with-tsrs)

### Docs site

- The site has search. Press ⌘K (Ctrl+K off a Mac) or the search button in the header, and it finds any page and the section of it that matches, such as `allowedHosts` in [Server rendering](server-rendering#the-server-entry). The index is built with Pagefind when the site is, and nothing of it loads until you open search: about 165 kB compressed then, most of it Pagefind's WebAssembly and the index.
- A link to a section, from "On this page", from search or from a URL with a `#`, leaves the heading below the header instead of under it, on a phone too. Try [What it checks](type-checking#what-it-checks).

### Type-checking

- The first type-check of a dev-server session waits until the server is idle, half a second with no request and no module compile, instead of starting one second after the server starts. Generating every component's type-check block ran on Vite's thread while the first page was compiling; on Super Productivity that was 0.67 s of the thread, and first paint went from 6.72 s to 6.00 s on a warm restart once the check waits. The first errors show up later, after the page instead of alongside it. Checks after edits are unchanged. [Type-checking](type-checking#what-you-see)

### Server rendering

- The dev server pre-bundles and caches the server's Angular libraries, in `node_modules/.vite/deps_ssr`, instead of linking and transforming them on every start. On the playground the first server-rendered page after a warm restart went from 1.3 s to 0.74 s. The server bundle has no source maps: a stack trace from inside Angular points into the readable pre-bundle. [Server rendering](server-rendering#what-the-plugin-does)

### Editing in the dev server

- A save can no longer be undone by a module Vite read just before it: components compiled afterwards see the saved file. [How it works](how-it-works#handling-an-edit)
- Template edits reach the page about 50 ms sooner on macOS. The plugin's 50 ms wait for the rest of a save now counts from when the template was written, not from when Vite's watcher reported it, and the watcher usually reports later than that. At 1,000 components the median template edit went from 169 ms to 120 ms. [How it works](how-it-works#component-hmr), [Performance](performance#template-edits)
- A class edit could reload the page twice, a second after the first reload. That happened when the plugin read the `.ts` file between a save truncating it and writing it. The plugin now waits out an empty read, the way Vite does. [How it works](how-it-works#component-hmr)
- `DEBUG=vite-plugin-ngp` also logs how long each step of a template update took. [Configuration](configuration#what-the-plugin-sets-for-you)

### Performance

- Every number on the [Performance](performance) page was measured again on the current plugin, in one run on 17 October: cold starts, restarts, edits, type errors, builds and bundle sizes for all four toolchains on all four apps, instead of the 16 October run with the plugin's edit row patched in from a later one. The results barely moved, which is the point: at 5,000 components the plugin shows the first page in 1.74 s where `ng serve` takes 28.3 s, a template edit lands in about 120 ms, and a build takes 20.2 s against 30.1 s. [Performance](performance)
- The page has a [Memory](performance#memory) section now. The generated apps were measured for memory the way the real apps are: at 5,000 components the plugin's dev server holds 1.0 GB after a restart where `ng serve` holds 6.0 GB, and 1.4 GB after the edits where `ng serve` holds 6.6 GB. Builds are even: 5.0 GB against 5.1 GB. [Performance](performance#memory)
- Both benchmark pages have figures. Each table of medians now has a chart above it, one bar per tool and app on a shared scale, with the plugin in violet and the fastest edit marked. They're drawn from the result files by `node bench/charts.mjs` and follow the site's dark theme. [Performance](performance#starting-the-dev-server), [Benchmarks on real apps](benchmarks#starting-the-dev-server)
- Bundle size has figures too: all the JavaScript a build writes and the initial part, gzipped, per tool and app. On the generated apps the plugin's output is within 3% of `ng build`'s; on Super Productivity it's 10% smaller than the CLI's, on Ghostfolio 3% larger. [Performance](performance#bundle-size), [Benchmarks on real apps](benchmarks#bundle-size)

### Benchmarks on real apps

- A new page, [Benchmarks on real apps](benchmarks): the plugin against the Angular CLI on Super Productivity and against Nx on Ghostfolio, two open-source apps, for dev-server starts, edits, production builds and memory, measured on GitHub's runners and on a laptop. On GitHub's 4-core runners the plugin restarts Ghostfolio's dev server in 4.5 s where Nx takes 21 s, updates a template in about 130–150 ms on both apps where the CLIs take 3.3–3.7 s, builds Super Productivity in 18 s where `ng build` takes 32 s, and holds a third to a half of the CLIs' memory while you work; its cold start of Super Productivity, 21.4 s against 23.1 s, is the one number that barely moves. It also lists what each app needed to run on a per-file compiler at all. The `bench-real` workflow reruns it on demand.
- [Status and limits](status#what-has-been-measured-and-what-hasnt) now says real apps, Linux and memory have been measured, and what still hasn't.

### Internationalization

- A translation file with a unit the parser can't read in full, such as a `{` in a translation that isn't an ICU expression, no longer fails `vite build`. The error is logged and the build goes on, as `ng build` does with the same file. Ghostfolio's Catalan translations have two such units. [Internationalization](i18n#the-build)

### This site

- A new page, [Compared with alternatives](comparison), sets vite-plugin-ngp next to `ng serve`, Analog (its default path and `fastCompile`) and `@oxc-angular/vite`: when each compiles, whose compiler it runs, type-checking, HMR, SSR, linking, and how you get it, with a source for every claim and where the plugin is weaker.
- A new page, [Migrating inside an Nx workspace](nx): how to move one app of an Nx workspace to the plugin while the rest stays on Nx. Vite's root in the app's folder, `tsconfig.base.json`'s paths as Vite aliases, libraries compiled from source with the app, `export type` and decorator metadata, Nx targets, and why `nx build my-lib` stays on ng-packagr. Checked on Ghostfolio, with Vite's root at the workspace root and at the app's folder.
- [Status and limits](status#what-doesnt-work-yet) says library builds aren't supported, and [Migrating from ng build](migrating-from-ng-build#cant-move-yet) lists a library project under what can't move.
- [Migrating from ng build](migrating-from-ng-build#where-every-option-goes) now says where `localize` and `i18nMissingTranslation` go, since i18n works. It listed them as not yet possible.
- An editing pass over every page: stale counts fixed, and the Server rendering page's prerender timing remeasured on the current 14 pages. [Server rendering](server-rendering#prerendering-for-static-hosting)
- The repo, [push-based/vite-angular](https://github.com/push-based/vite-plugin-ngp), is public. Building ngp ([docs/building.md](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/building.md)) now starts with `git clone` instead of asking for access, and no page calls the repo private any more.
- Tables no longer break option names or types mid-word. The [Options](configuration#options) table puts each option's type and default in one cell so it fits the docs column, and on a phone every table with three or more columns stacks each row into labeled lines.

## 16 October 2026

The first day: from an empty repo to a plugin that compiles, serves, renders, tests and type-checks Angular through ngp.

### Compiling and building

- Every `.ts` module compiles on request with ngp's optimize mode, from the code Vite hands over, with no whole-program pass first. [How it works](how-it-works#compiling-one-module)
- Angular libraries are linked, in dependency pre-bundling and in builds, so the browser never needs the JIT compiler. [How it works](how-it-works#linking-libraries)
- The plugin defines Angular's compile-time globals (`ngDevMode`, `ngJitMode`, `ngServerMode`, `ngHmrMode`) the way the CLI does. [How it works](how-it-works#compile-time-globals)
- `vite build` runs Angular's build optimizer, which brings the playground's JavaScript to within 2% of `ng build`'s. [How it works](how-it-works#the-build-optimizer)
- ngp builds inside the repo with one command, `pnpm toolchain`, with no Rust installed beforehand. [docs/building.md](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/building.md)

### Editing in the dev server

- Component HMR: an external template edit updates the running component in place, keeping its state. [How it works](how-it-works#component-hmr)
- A `.ts` edit that only changes a component's inline `template` or `styles` updates in place too, with the CLI's rules for what's safe. [How it works](how-it-works#component-hmr)
- One save that changes a component's class and its template reloads once, instead of applying a template the class can't run yet. That holds however far apart, and however often, the watcher reports the two files, as macOS's does. [How it works](how-it-works#component-hmr)
- Adding, renaming and deleting files compiles as a fresh build would. Deleting a file that's still used is an error until it's back, and a missing `templateUrl` file reports `NG2008` instead of rendering a blank component. [How it works](how-it-works#handling-an-edit)

### Styles, type-checking and tests

- Component stylesheets (`styleUrl`, `styleUrls`) go through Vite's CSS pipeline, so Sass, PostCSS and CSS HMR apply. [Component styles](styles)
- Templates and TypeScript are type-checked with TypeScript 7 over ngp's type-check blocks, in a separate process, with errors in the terminal and the overlay. New option: `typeCheck`. [Type-checking](type-checking)
- Angular specs run under Vitest, compiled ahead of time with ngp. [Testing with Vitest](testing)

### Moving from ng build

- New options `fileReplacements`, `budgets` and `polyfills`, in angular.json's shapes. Replacements reach ngp's analyzer too, budgets print the CLI's messages and fail the build on errors, and zone.js apps get `async`/`await` rewritten so change detection still runs after an `await`. Every other build option is mapped to Vite config. [Migrating from ng build](migrating-from-ng-build)

### Internationalization

- New option `i18n`: Angular's `i18n` attributes and `$localize`, with a dev server in one locale and a `vite build` that writes one translated folder per locale, server bundles included. [Internationalization](i18n)
- `ngp-extract-i18n` writes the app's messages as XLIFF 1.2 or 2.0, XMB, JSON or ARB, like `ng extract-i18n`. [Internationalization](i18n#extract-the-messages)
- The compiler reads `enableI18nLegacyMessageIdFormat` and `i18nNormalizeLineEndingsInICUs` from `angularCompilerOptions`, and the plugin defines `ngI18nClosureMode`, so message ids match `ng build`'s. [Internationalization](i18n#mark-text-for-translation)

### Server rendering

- New option `ssr`: pages render on the server in the dev server, and `vite build` builds a server bundle beside the browser one. [Server rendering](server-rendering)
- Server builds bundle and link every Angular library in your `dependencies`. [Server rendering](server-rendering#what-the-plugin-does)

### Performance

- The first end-to-end numbers, against `ng serve`, Analog and `@oxc-angular/vite`: at 5,000 components the plugin shows the first page in 1.9 s where `ng serve` takes 28.5 s, and a template edit in about 150 ms where `ng serve` takes 1.8 s. The harness is in the repo's `bench/` folder. [Performance](performance)

### This site

- Docs at https://push-based.github.io/vite-plugin-ngp/, built with the plugin itself and prerendered with Angular SSR. They redeploy on every push.
- Dark theme, copy buttons, heading links, the file name on each snippet, and `llms.txt` for AI assistants.
