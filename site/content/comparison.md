---
title: Compared with alternatives
description: How vite-plugin-ngp differs from ng serve, Analog and @oxc-angular/vite in when it compiles, whose compiler it uses, type-checking, HMR, SSR, linking and how far along it is.
---

# Compared with alternatives

You already have three ways to run Angular with Vite in the picture: the Angular CLI, Analog's Vite plugin, and VoidZero's `@oxc-angular/vite`. This page is for you if you're choosing between them and want to know what vite-plugin-ngp does differently, and what it costs you. It compares how each one works, with one timing where a difference in the model shows up. [Performance](performance) has the rest.

In one sentence: vite-plugin-ngp is the only one that compiles each module when Vite asks for it with Angular's own compiler, and the only one built on a prototype compiler: its npm package carries an unofficial build of ngp and works with exactly one Angular prerelease.

Analog and `@oxc-angular/vite` were checked in their source and docs on 17 October 2026: `@analogjs/vite-plugin-angular` 2.8.1, npm's `latest`, at commit [`58a9df6`](https://github.com/analogjs/analog/tree/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular), and `@oxc-angular/vite` 0.0.41 with its repo at [`7c84088`](https://github.com/voidzero-dev/oxc-angular-compiler/tree/7c84088778dc4b2b5b4f33fd6c98af0e3a134fe5). Both change fast, so anything below can be out of date by the time you read it.

## At a glance

| | `ng serve` / `ng build` | Analog, default | Analog, `fastCompile` | `@oxc-angular/vite` | vite-plugin-ngp |
|---|---|---|---|---|---|
| When it compiles | Whole program, before serving | Whole program, before serving | Per file, after a scan of every file | Per file, on request | Per file, on request |
| Whose compiler | ngc | ngc | Analog's, on `@angular/compiler` | VoidZero's, in Rust | ngp: Angular's analyzer and template compiler |
| Output matches ngc's | It is ngc | It is ngc | "87%+" of Ivy instructions, by its own tests | Not measured as a whole | Angular's ngp golden tests pass; bundles within 3% of `ng build` |
| Template type-checking | Yes | Off by default; on under `@analogjs/platform` | No | No | Yes, in a separate process |
| Component HMR | On by default | Off by default | Off by default | On by default | On by default, with the CLI's rules |
| SSR | `@angular/ssr`, with prerendering | `@analogjs/platform`, on by default | Same as default | An `ssrEntry` option; not tried here | A `render(url, document)` contract; you write the server |
| Linking libraries | The CLI's oxc linker | Angular's linker | Angular's linker | Its own Rust linker | A port of the CLI's oxc linker |
| How you get it | `npm install` | `npm install`, 2.8.1 | `npm install`, opt-in flag | `npm install`, 0.0.41, "experimental" | `npm install`, 0.2.0; one Angular prerelease |

Each row is explained below, with its source.

## When compilation happens

This is the difference the others follow from. ngc, the compiler behind `ng build` and behind Analog's default path, can't compile one file until it has built a TypeScript program of the whole project and analyzed every decorator in it ([How it works](how-it-works#why-per-module-compilation-was-impossible-before)).

- **`ng serve`** runs the CLI's esbuild builder over the whole app and keeps the output in memory. Vite only serves it: its own TypeScript transform is switched off and it never sees your source modules. The CLI has a slot for a per-file transform ([angular/angular-cli#33862](https://github.com/angular/angular-cli/pull/33862)), but as of 16 October 2026 the mode that would use it throws `Transform compilation mode is not supported.`
- **Analog's default path** builds an `NgtscProgram` in `buildStart` and compiles everything. Its `transform` hook returns that cached output and ignores the code Vite passes it ([source](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular/src/lib/angular-vite-plugin.ts#L824-L846)), so a change another Vite plugin makes to a `.ts` file never reaches the compiler.
- **Analog's `fastCompile`**, off by default, compiles per file from Vite's code. It first scans every file with oxc in `buildStart` to build a registry of selectors and inputs ([source](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular/src/lib/fast-compile-plugin.ts#L209-L300)).
- **`@oxc-angular/vite`** compiles each file in its `transform` hook. It reads your tsconfig "for file discovery, not TypeScript compilation", in its own words, and reads imported files when a decorator's metadata comes from them.
- **vite-plugin-ngp** compiles each file in its `transform` hook from the code Vite hands over. ngp's analyzer resolves references across files on demand, so the first module needs no whole-program pass. An edit recompiles only the modules the page still uses ([How it works](how-it-works#handling-an-edit)).

So `ng serve` and Analog's default path take longer to start the bigger your app is, and the per-file tools mostly don't. On a generated 5,000-component app, from a cold start to the first paint, `ng serve` took 28.3 s, Analog 6.46 s, vite-plugin-ngp 1.74 s and `@oxc-angular/vite` 1.11 s, on one laptop on 17 October 2026 ([Performance](performance#starting-the-dev-server)).

## Whose compiler produces the output

This is where the per-file tools split. `fastCompile` and `@oxc-angular/vite` are reimplementations of Angular's compiler. vite-plugin-ngp uses Angular's own.

- **`fastCompile`** is Analog's front end on top of `@angular/compiler`. Its own docs list an "87%+ Ivy instruction match" against Angular's compliance tests, and no template source maps ([COMPILER.md](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular/src/lib/compiler/COMPILER.md?plain=1#L209-L219)).
- **`@oxc-angular/vite`** is a Rust port of Angular's template compiler. Its conformance suite passes 1,264 assertions extracted from Angular's own spec files, at Angular v22.0.0-rc.2, but those cover parsing, the template transform and CSS scoping, not whole compiled files. VoidZero's launch post, of 10 April 2026, says it "does not implement Angular's cross-file optimizations" ([post](https://voidzero.dev/posts/oxc-angular-compiler)). One difference showed up in the [bundle-size comparison](performance#bundle-size): its builds don't give `@defer` blocks chunks of their own.
- **vite-plugin-ngp** runs ngp, which Angular merged into its compiler-cli on 8 October 2026: a Rust analyzer plus Angular's existing template compiler, in TypeScript. It's Angular's code, so where Angular's compiler changes, ngp changes with it. Angular's own golden tests for ngp, which compare its output with what Angular expects, pass on the commit the plugin builds. Compiled one module at a time in optimize mode, every module matched ngp's full build ([decision 2](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/decisions.md#2-optimize-mode-only-in-dev-and-in-production)). The plugin's production bundles are within 3% of `ng build`'s, gzipped, on the generated apps ([Performance](performance#bundle-size)).

Where this is weak: nobody has diffed a whole app's output from ngp against ngc's file by file. The evidence is Angular's golden tests, the per-module check and bundle sizes. And ngp is a prototype; its README says the Angular team isn't taking outside issues or pull requests yet.

## Template type-checking

- **`ng serve` and `ng build`** type-check your TypeScript and templates in dev and in builds.
- **Analog's default path** sets `disableTypeChecking: true` by default ([source](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular/src/lib/angular-vite-plugin.ts#L193)). `@analogjs/platform`, Analog's meta-framework, turns it back on ([source](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/platform/src/lib/platform-plugin.ts#L127)). When it's on, it runs on the compile path, in Vite's process.
- **`fastCompile`** doesn't type-check templates. Its docs say that needs a full `ts.Program`, and point you to the Angular Language Service in your editor.
- **`@oxc-angular/vite`** doesn't either. VoidZero's launch post says so, and the plugin has no type-checker for app builds.
- **vite-plugin-ngp** asks ngp for a type-check block per component and runs TypeScript 7 over your app and those blocks in a child process. Errors land where `ng build` puts them, show in Vite's overlay, and fail `vite build` ([Type-checking](type-checking)).

Where vite-plugin-ngp is weak here: every check is whole-program, so on a large app an error takes over a second to appear ([Type-checking](type-checking#where-its-weak)). It never holds up an edit, but it isn't per-file the way compiling is.

## HMR

Four of them use the CLI's runtime protocol: the compiler adds an HMR initializer to each component, the dev server sends `angular:component-update`, and the component fetches its new template from `/@ng/component`. They differ in when an edit counts as a template edit, and whether it's on by default.

- **`ng serve`** updates components in place by default. It decides from the edited `.ts` file: if only a decorator's `template` or `styles` changed, the component updates; anything else reloads the page.
- **Analog's default path** has component HMR behind `liveReload`, which is off by default in 2.8.1 ([source](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular/src/lib/angular-vite-plugin.ts#L192)), so template edits reload the page. Turned on, it didn't update the page on the generated apps in our run of 16 October ([Performance](performance#template-edits)).
- **`fastCompile`** is the exception. Behind the same `liveReload` flag, it lets Vite replace the whole module and copies the new class's compiled definitions onto the running one with Angular's `ɵɵreplaceMetadata`. Root components reload ([COMPILER.md](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/vite-plugin-angular/src/lib/compiler/COMPILER.md?plain=1)). We haven't run it.
- **`@oxc-angular/vite`** turns `liveReload` on by default and compares the file with its `template` and `styles` emptied out, which is close to the CLI's rule.
- **vite-plugin-ngp** ports the CLI's rule from `@angular/build` ([How it works](how-it-works#component-hmr)). Two cases reload here that update in place under `ng serve`: a template kept in a constant outside the decorator, and a change to `templateUrl` or `styleUrl`. It also holds a template update until 50 ms after the template was written, in case the same save changed the class.

## Server rendering

- **`ng serve` and `ng build`** have `@angular/ssr`: `AngularNodeAppEngine`, per-route render modes, prerendering and HTTP status codes.
- **Analog** does SSR through `@analogjs/platform`, which turns it on by default ([source](https://github.com/analogjs/analog/blob/58a9df609050ba9d43bcc062316a477216a03015/packages/platform/src/lib/platform-plugin.ts#L49)). Its client and server builds share one compiler state and compile one after the other.
- **`@oxc-angular/vite`** has an `ssrEntry` option and a plugin that writes an SSR manifest, and leaves HMR code out of server transforms. We haven't run its SSR.
- **vite-plugin-ngp** renders through your own server entry, behind a `render(url, document)` contract, in the dev server and in builds ([Server rendering](server-rendering)). This site is prerendered that way.

Where vite-plugin-ngp is weakest here: it has none of `@angular/ssr`'s features. No status codes, so a not-found page answers 200; no per-route render modes; no built-in prerendering, so you write the loop. And the dev server runs two ngp analyzers with SSR on, one per environment ([Server rendering](server-rendering#limits)). If your app relies on `@angular/ssr`, stay on the CLI or Analog for now.

## Linking libraries

Angular libraries ship partially compiled, and every one of these tools has to link them, Angular's own packages included. It has nothing to do with how your code is compiled.

- **The Angular CLI** links with an oxc-based linker it moved to in 2026 ([angular/angular-cli#33625](https://github.com/angular/angular-cli/pull/33625)). It's private to `@angular/build`.
- **Analog** runs Angular's linker in Vite's dependency optimizer and on library files in builds.
- **`@oxc-angular/vite`** has its own linker in Rust.
- **vite-plugin-ngp** runs Angular's `FileLinker` over Vite's oxc parser, a port of the CLI's private pair, in pre-bundling, builds, server bundles and Vitest ([How it works](how-it-works#linking-libraries)).

Until 9 November 2026 the plugin used Angular's public Babel linker, and that was the slow one: most of the plugin's cold start at 5,000 components is Vite pre-bundling Angular's packages, which runs the linker, and a restart skips it ([Performance](performance#starting-the-dev-server)). The oxc port links the same modules about three times faster in a direct comparison; the bench hasn't been rerun since ([decision 65](https://github.com/push-based/vite-plugin-ngp/blob/main/docs/decisions.md#65-link-with-a-port-of-the-clis-oxc-linker)).

## Maturity and installing it

This is where vite-plugin-ngp loses, plainly.

- **The Angular CLI** is Angular's official toolchain.
- **Analog** 2.8.1 is on npm and is a released, maintained project; 3.0 is in alpha. Its default path imports private `@angular/build` APIs, and Angular 22.2 broke it in three reported issues ([the bench's audit](https://github.com/push-based/ng-hybrid-preprocessor-bench/blob/main/docs/vite-plugin-analog-audit.md)).
- **`@oxc-angular/vite`** 0.0.41 is on npm, with prebuilt binaries for macOS, Linux and Windows. Its README says it's "in an experimental stage and is actively seeking maintainers", and the launch post called it "an experiment for research purposes". Commits are still landing: the last on 16 October 2026.
- **vite-plugin-ngp** 0.2.0 is on npm as `@push-based/vite-plugin-ngp`, first published on 21 October 2026. ngp isn't published, so the package carries its own build of it, made from Angular's source, with native engines for macOS and glibc Linux ([Getting started](getting-started)). Every Angular package is pinned to exactly `22.3.0-next.4`, a prerelease, because ngp's API isn't public and the plugin reaches below it in two places ([Status and limits](status#where-its-weakest)). It runs on macOS and Linux, and elsewhere with the slower wasm engine; Windows is untested.

## Which one to pick

- **You ship an Angular app today and need it to keep working:** the Angular CLI. Nothing here replaces it yet.
- **You need Vite's plugin ecosystem, file-based routing or a meta-framework in production:** Analog, with `@analogjs/platform` so type-checking is on.
- **You want the fastest builds and can live without template type-checking and with a compiler that isn't Angular's:** `@oxc-angular/vite`, knowing its maintainers call it experimental.
- **You want per-module compilation with Angular's own compiler and type-checking, and can build ngp from source and pin one Angular prerelease:** vite-plugin-ngp. It's a prototype on a prototype, and [Status and limits](status) lists what it can't do yet.

The gap this plugin fills closes when Angular ships ngp. The CLI's code points to ngp as a per-file transform inside its esbuild builder, with Vite still only serving, and Angular's blog of 25 September 2026 puts an experimental release "later this year" ([post](https://blog.angular.dev/an-update-on-angulars-typescript-7-powered-compiler-9619a35e2b0a)). Whether Vite owns the module graph then is the open question.
