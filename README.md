<img src="site/public/logo.svg" alt="vite-plugin-ngp logo" width="128" height="128" />

# vite-plugin-ngp

[![ci](https://github.com/push-based/vite-plugin-ngp/actions/workflows/ci.yml/badge.svg)](https://github.com/push-based/vite-plugin-ngp/actions/workflows/ci.yml)
[![pages](https://github.com/push-based/vite-plugin-ngp/actions/workflows/pages.yml/badge.svg)](https://github.com/push-based/vite-plugin-ngp/actions/workflows/pages.yml)

**vite-plugin-ngp** lets Vite compile Angular one module at a time, with ngp, the Rust-and-TypeScript preprocessor Angular merged on 8 October 2026. Vite owns the module graph and asks for each file when the browser needs it. No whole-program compile runs first, unlike `ng serve` or Analog.

**Docs: https://push-based.github.io/vite-plugin-ngp/**

## Why it exists

Every Angular dev server today is built on ngc, which can't compile one file until it has built a TypeScript program for the whole project. So the tools work around Vite instead of with it. `ng serve` uses Vite only to serve esbuild's output. Analog compiles the whole program up front and ignores the code Vite passes to its transform. That's where slow cold starts and whole-program recompiles on every edit come from.

ngp's analyzer answers per file, on demand, with output identical to a full build. That's what a Vite transform needs. On a generated app of 5,000 components, the plugin shows the first page 1.6 s after you start the dev server, where `ng serve` takes 28.4 s. A template edit reaches the page in 100–130 ms, where `ng serve` takes 1.8 s. Both were measured end to end on one laptop; the [Performance](https://push-based.github.io/vite-plugin-ngp/performance/) page has the tables, and [Benchmarks on real apps](https://push-based.github.io/vite-plugin-ngp/benchmarks/) does the same on Super Productivity and Ghostfolio.

## What works

A first version on top of a prototype compiler. Everything below was checked in the [playground](playground) or on the docs site, which is itself built with the plugin.

- Per-module compilation from the code Vite hands over, in dev and in production builds.
- Component HMR for external templates, stylesheets, and inline `template` and `styles`. Other `.ts` edits reload the page, as under `ng serve`.
- Server rendering with hydration, in the dev server and in builds.
- Template and TypeScript type-checking in a separate process, with TypeScript 7 or tsrs. Errors show in the terminal and the browser overlay, and fail `vite build`.
- Production builds with Angular's linker and the CLI's build optimizer. The JavaScript comes out within 3% of `ng build`'s.
- Component stylesheets through Vite's CSS pipeline, so Sass and PostCSS work, with Angular's view encapsulation.
- Angular i18n: extraction, and one translated folder per locale from a single build.
- Vitest with TestBed, compiling only the specs a run asks for.
- `fileReplacements`, `budgets` and `polyfills` from angular.json, and one app at a time in an Nx workspace.

**Not yet:** preprocessors in inline `styles`, HTTP status codes from SSR, the service worker, library builds, and Windows outside WSL 2, which is untested.

**The catch.** It's on npm as [`@push-based/vite-plugin-ngp`](https://www.npmjs.com/package/@push-based/vite-plugin-ngp), but ngp isn't published, so the package carries its own build of it, made from Angular's source, and every `@angular/*` package is pinned to exactly `22.3.0-next.4`. The plugin also uses ngp below its intended surface, so any Angular commit can break it. The [status page](https://push-based.github.io/vite-plugin-ngp/status/) lists every limit.

## Try it

You need macOS or Linux, Node 26, and every `@angular/*` package pinned to exactly `22.3.0-next.4`.

```bash
npm install -D @push-based/vite-plugin-ngp vite@8.3.4
```

```ts
// vite.config.ts
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp()],
});
```

[Getting started](https://push-based.github.io/vite-plugin-ngp/getting-started/) has the rest: the `index.html` Vite starts from, and which tsconfig the plugin reads. If you're coming from `ng build`, [Migrating from ng build](https://push-based.github.io/vite-plugin-ngp/migrating-from-ng-build/) says where each option goes.

To run the playground in this repo, or to work on the plugin, [docs/building.md](docs/building.md) builds ngp from a clone.

## How it works

- **Compile on request.** Vite's `transform` hands each `.ts` file to ngp, which returns TypeScript with the decorators compiled away.
- **Edits stay small.** The analyzer reports which files went stale, and the plugin invalidates just those in Vite's module graph, instead of recompiling the program.
- **Libraries get linked.** Angular's linker runs on `node_modules` in pre-bundling and in builds, so the browser never needs the JIT compiler.
- **HMR speaks the CLI's protocol,** so Angular's runtime applies component updates unchanged.

[How it works](https://push-based.github.io/vite-plugin-ngp/how-it-works/) has the details, and [Compared with alternatives](https://push-based.github.io/vite-plugin-ngp/comparison/) sets the plugin next to `ng serve`, Analog and `@oxc-angular/vite`.

## What's in this repo

| Path | What it is |
|---|---|
| [packages/vite-plugin-ngp](packages/vite-plugin-ngp) | The plugin and its tests |
| [playground](playground) | A demo app with one page per Angular feature area. Its [README](playground/README.md) says what each page exercises |
| [site](site) | The docs site, an Angular app built with the plugin. Its pages are Markdown in [site/content](site/content) |
| [bench](bench) | The benchmark behind the Performance and Benchmarks pages |
| [toolchain](toolchain) | Builds ngp from Angular's source, at the commit in [versions.env](toolchain/versions.env) |
| [docs](docs) | Notes for contributors: [building](docs/building.md), [design](docs/design.md) and the [decision log](docs/decisions.md) |

## Contributing

`pnpm test` builds the plugin and runs its tests against the ngp you built; CI runs the same on every push. [docs/building.md](docs/building.md) explains each build step, what to do when one fails, and how to move to a newer Angular commit.

A change a plugin user would notice needs its docs page in [site/content](site/content) updated in the same commit, and a line in the [changelog](site/content/changelog.md). The site redeploys on every push to `main`. Design choices go in [docs/decisions.md](docs/decisions.md), with what they cost. Commit messages are [conventional commits](https://www.conventionalcommits.org/), checked by a commit-msg hook, because releases are computed from them; [docs/releasing.md](docs/releasing.md) explains the rules and how a version reaches npm.

## Related

- [angular/angular#71259](https://github.com/angular/angular/pull/71259): the pull request that merged ngp into Angular.
- [ng-hybrid-preprocessor-bench](https://github.com/push-based/ng-hybrid-preprocessor-bench): PushBased's benchmark of ngp against ngc, and the investigation this plugin started from.
