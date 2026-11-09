# End-to-end benchmark

This measures vite-plugin-ngp against the three other ways to run Angular on Vite or in Angular's own build: the Angular CLI (`ng serve` and `ng build`), Analog's `@analogjs/vite-plugin-angular`, and VoidZero's `@oxc-angular/vite`. It times what a developer waits for, from process start to pixels in a real browser, on the same apps with the same Angular, and records how much memory each tool's processes hold while it does. The results and what they mean are on the docs site's [Performance page](../site/content/performance.md), for the generated apps, and its [Benchmarks page](../site/content/benchmarks.md), for two real open-source apps against their own CLI. This page is for running it again.

## What it measures

| Metric | From | To |
|---|---|---|
| Dev server, cold start | spawning the dev server, with every cache deleted | the first contentful paint of the rendered app in headless Chrome |
| Dev server, restart | the same, keeping the caches the previous start wrote | the same |
| Template edit | writing an external template | the new element in the DOM, and whether the page reloaded to get it |
| `.ts` edit | changing a signal's initial value in a page component | the new text in the DOM (every tool reloads the page for this) |
| Production build | spawning the build, with caches deleted | the process exiting |
| Bundle size | the build's output | all JavaScript, and the initial part (what `index.html` loads plus its static imports), raw and gzipped |
| Type error in dev (ngp and the CLI only) | planting `{{ benchMissingN }}` in a template | the dev server's terminal naming `benchMissingN`; then, after removing it, the terminal reporting the app clean |
| Memory | every start, edit series and build | the peak resident memory of the tool's whole process tree, sampled every 100 ms with `ps`, and for a dev server what it holds once the page has rendered and settled, and after the edits |

Memory is the sum of each process's resident set size: the Vite or CLI process plus what it spawned, which is esbuild, `tsgo`, Sass's Dart VM and worker processes, depending on the tool. Pages shared between processes count once per process, so a tree's sum is an upper bound. It's the number `top` would add up, and the one a laptop runs out of. Headless Chrome isn't in it. See [lib/memory.mjs](lib/memory.mjs).

Starts and builds take 1 warm-up and 5 measured runs by default. Edits take 2 warm-ups and 10 measured edits in one dev-server session. Reported numbers are medians. A result whose median absolute deviation exceeds 5% of its median is marked noisy in the report.

Starts and builds run in rounds, one tool after another, so a slow drift in the machine's load spreads across all tools instead of landing on one.

## What has to hold before a number counts

A sample that fails any of these is not timed, and the report marks the tool as failed for that metric.

1. **The app rendered.** For a generated app: every feature link in the shell and the first lazy route's page heading. For the playground: the overview's heading and its four pipeline steps.
2. **No errors.** No `console.error`, uncaught exception or HTTP error in the page. The one exception is `/favicon.ico`: the generated apps have none and Chrome asks anyway.
3. **The page settled.** If Vite's dependency optimizer reloads the page after its first paint, the harness waits for the reload and times the document that stays. `firstPaint` in the result files keeps the earlier paint.
4. **The edit arrived and stuck.** The marker the edit wrote is in the DOM, and still there 800 ms later.
5. **The build boots.** It exits 0, renders the app from a static server, and renders a second lazy route after a router navigation.
6. **The app is unchanged.** A SHA-256 over `src/` before and after every app's run.

## Run it

You need Node 26 (`nvm use` in the repo root), pnpm, Chrome, and an ngp build (`pnpm toolchain` in the repo root, then `pnpm build` for the plugin).

```bash
cd bench && pnpm install
```

```bash
node apps.mjs
```

That writes the three generated apps and a copy of the playground to `.work/apps.noindex`. Then, from `bench/`:

```bash
NGP_TOOLCHAIN="$PWD/../toolchain/out" node run.mjs --apps standalone-1000-s1 --max-load 6
```

Options: `--apps` (`standalone-100-s1`, `standalone-1000-s1`, `standalone-5000-s1`, `playground`, and the real apps below), `--tools` (`ngp`, `cli`, `nx`, `analog`, `oxc`, plus the variants below), `--metrics` (`dev-cold`, `dev-warm`, `edit`, `build`, and `typecheck`, which isn't in the default set), `--runs`, `--warmup`, `--edits`, `--edit-warmup`, and `--max-load`, which holds each sample until the 1-minute load average is below that number. Results go to `results/<timestamp>.json` unless `--out` says otherwise. A full run of all four apps took about an hour on an M2 Max.

```bash
node report.mjs results/*.json
```

That prints the markdown tables. A later file wins over an earlier one for the same app, tool and metric, so you can rerun one series and merge it.

```bash
node charts.mjs --generated results/<generated>.json --real results/ci-super-productivity.json,results/ci-ghostfolio.json
```

That draws the figures on the docs site's Performance and Benchmarks pages into `site/content/charts/`, from the same files: horizontal bars per tool and app on one scale, the plugin's in the brand violet and the others' in gray, with the fastest edit marked on the edit figures and the bundle figures showing gzipped JavaScript, all of it and the initial part. The site inlines them, so they take the site's colors and dark theme; [docs/decisions.md](../docs/decisions.md) entry 51 says why. Rerun it whenever the files behind a page change, and commit the SVGs with the page.

## The tools, and how each is set up

Every tool runs from `bench/node_modules` with Angular 22.3.0-next.4, the version ngp is built from, and the three Vite plugins with Vite 8.3.4. Each one gets its README's setup and nothing else, written into the app by [lib/tools.mjs](lib/tools.mjs). The only additions are a separate `cacheDir` and `build.outDir` per tool, so no tool reuses another's dependency cache or output.

| Tool | Dev | Build | Type-checks? |
|---|---|---|---|
| vite-plugin-ngp | `vite` with `ngp()` | `vite build` | yes, in a background `tsgo` process in dev, and before a build finishes |
| Angular CLI | `ng serve` (development) | `ng build` (production) | yes, in both |
| Analog | `vite` with `angular()` and `resolve.mainFields: ['module']` | `vite build` | no: `disableTypeChecking` defaults to true |
| @oxc-angular/vite | `vite` with `angular()` | `vite build` | no, by design |

Three variants are opt-in, for questions the defaults can't answer: `ngp-notc` (`typeCheck: false`, to compare builds with the tools that don't type-check), `ngp-tsrs` (`typeChecker: 'tsrs'`, the plugin's check with Oxc's Rust port of TypeScript 7 instead of `tsgo`; the bench installs `tsrs` for it) and `analog-hmr` (`liveReload: true`, Analog's opt-in component HMR).

Where the setup isn't what a user would get from `npm install`, and why:

- **Analog is 2.8.2-beta.1, patched.** The latest stable, 2.8.1, fails `vite build` on Angular 22.3: its build optimizer calls `@angular/build`'s private `JavaScriptTransformer` without the `initializeHash()` call that 22.2 started to require. 2.8.2-beta.1 adds the call behind a version check, but the check computes the version with `Number('0-next.4')`, which is `NaN` for a prerelease, so it still fails. [patches/](patches) changes that one line to `parseInt`. On a stable Angular 22.2 or later, the unpatched beta would take the same path.
- **@oxc-angular/vite 0.0.41 targets Angular 22.2.2's output.** It doesn't use Angular's compiler at all, so the Angular version only matters at runtime here.
- **The CLI can't run the playground.** The playground reads `import.meta.env` and `import.meta.hot`, which only Vite defines. The generated apps are plain Angular CLI workspaces and run everywhere.
- **The playground runs without SSR.** Its own config turns on vite-plugin-ngp's server rendering, which none of the others offers in the same form, so every tool renders it in the browser.
- **The playground's copy imports `@angular/localize/init` first in `src/main.ts`.** The playground marks its text for i18n, so every component calls `$localize`, and without the runtime none of them renders. Its own config gets the runtime from vite-plugin-ngp's `i18n` option, which only ngp has. Giving each tool its own way in would mean ngp loads the runtime from a virtual module and the others from an import, and builds would differ too: ngp's `i18n` option inlines the messages, the others would ship the runtime. So every tool gets the same one line, the runtime `ng add @angular/localize` puts in an app's polyfills, and runs the same code: the source locale, untranslated, in dev and in builds. Stripping the `i18n` marks instead would also be equal, but it would measure an app that isn't the playground. The cost is that ngp's build numbers on the playground are for an app without its i18n option, so they include the `$localize` runtime a real ngp i18n build drops.

## Real apps

Two open-source Angular apps run against their own CLI, with the plugin set up on them the way the docs say to move an app off `ng build`. Each is pinned in [real/](real): `<name>.json` has the repo, the commit, the install command, how its CLI serves and builds it, how the harness tells it rendered, and which files an edit touches. `<name>/` has the files the bench adds to the app, and `<name>.patch` the changes to its sources, each with a header saying why.

| App | Built with | Components | What the plugin's setup needed |
|---|---|---:|---|
| [Super Productivity](https://github.com/johannesjo/super-productivity) `65145cd` | Angular CLI, `ng serve` and `ng build --configuration production` | 252 | tsconfig paths as Vite aliases, angular.json's `assets` list, Sass `loadPaths`, a stub for an uninstalled external dependency, typia's compile-time transform ([bench-typia.mjs](real/super-productivity/bench-typia.mjs)), esbuild's CSS minifier, decorator metadata off, the service worker ([shared/bench-ngsw.mjs](real/shared/bench-ngsw.mjs)) |
| [Ghostfolio](https://github.com/ghostfolio/ghostfolio) `204f0d8` | Nx, `nx run client:serve:development-en` and `nx run client:build:production` | 157 | tsconfig paths as Vite aliases, 13 locales as the `i18n` option, a stub API ([api-stub.mjs](real/ghostfolio/api-stub.mjs)) that both tools talk to, decorator metadata off, the service worker |

```bash
node real.mjs super-productivity
```

```bash
node real.mjs ghostfolio
```

That clones each app at its commit into `.work/real.noindex/`, pins every `@angular/*` package to `22.3.0-next.4`, runs the app's own install, applies the patch, writes a root `index.html` from the app's own plus the stylesheet links and entry script its CLI injects, and copies `vite.config.ngp.mjs` and its helpers in. Then:

```bash
NGP_TOOLCHAIN="$PWD/../toolchain/out" node run.mjs --apps super-productivity,ghostfolio --tools ngp,cli,nx
```

A real app runs under two tools: the plugin, and the one CLI it's built with (`cli` is the Angular CLI, `nx` is Nx; the harness skips the other). Analog and `@oxc-angular/vite` aren't set up on the real apps.

What each app needed, and why it's fair:

- **Both tools get the same sources, patches included.** The patches are small and mechanical. Super Productivity: `export type` on 7 re-export statements that TypeScript's `isolatedModules` check flags (TS1205), written by TypeScript's own quick fix through [real/isolated-modules-fix.mjs](real/isolated-modules-fix.mjs), because a per-file compiler can't tell a re-exported interface from a value and the browser refuses to link the module; plus two casts TypeScript 7 needs. Ghostfolio: one such `export type`, and `$any()` on two expressions where ngp's type-check blocks report a TS2774 that ngc's don't. `ng build` and `nx build` compile the patched files too.
- **Both tools do the same job.** Where the plugin has no option for something the app's CLI does, the bench adds it next to the plugin, in the app's `vite.config.ngp.mjs`, as a Vite user would: a Vite plugin that runs typia's TypeScript transformer over a TypeScript program (Super Productivity validates with typia, and `ts-patch` gives `ng build` that for free), and Angular's `ngsw-config` after the build for the service worker both apps register. These cost the plugin time that `ng build` also spends; they're in its numbers.
- **The CLIs run as the apps configure them.** `ng serve` on Super Productivity is a JIT development build, because its `development` configuration says `aot: false`. `nx` runs with its daemon off (`NX_DAEMON=false`) and `--skip-nx-cache`, so every start and build is its own process and no build is a cache hit; the Nx project graph is a second or so of each.
- **Ghostfolio talks to a stub API.** Its client fetches `/api/v1/info` before it bootstraps, so without an API nothing renders under any tool. [api-stub.mjs](real/ghostfolio/api-stub.mjs) answers that from a saved response of the public instance, answers `/api/v1/user` with 401 as the real API does for a visitor, and serves the client's assets. Both tools proxy `/api` and `/assets` to it, as the app's own `proxy.conf.json` does to the real API, and the harness ignores the 401.
- **Vite's dependency optimizer may reload the page once on a cold start**, when the first scan missed a dependency. The harness times the document that stays, and ignores the 504 "Outdated Optimize Dep" answers Vite gives the old one.
- **No `.ts` edit on Super Productivity.** Its Today view renders no string literal from a component class, so there is nothing a class edit could change that the harness can see. Ghostfolio's landing page renders a testimonial from its component, so it gets one.

## The generated apps

[corpus/generate.mjs](corpus/generate.mjs) is the bench repo's generator, vendored. It writes the same `src/` byte for byte for the same size and seed. It adds the `serve` target `ng new` writes, which the bench repo didn't need, and records in `manifest.json` which files the harness edits: the first route's page component, and the first external template that route renders outside a `@defer` block. The bench repo's [methodology](https://github.com/push-based/ng-hybrid-preprocessor-bench/blob/main/docs/methodology.md#corpus) describes what's in the apps.

## On CI

[.github/workflows/bench-real.yml](../.github/workflows/bench-real.yml) runs the real apps on GitHub's Ubuntu runners, one app per job on its own runner: it builds ngp, installs the app at its commit, runs `run.mjs`, and a last job merges the result files into one report in the run's summary. Start it from the Actions tab ("Run workflow"), or:

```bash
gh workflow run bench-real
```

It isn't run on every push, because a full run takes about an hour per app. The result files behind the Benchmarks page are copied from the run's artifacts into [results/](results) as `ci-<app>.json`; each records the run's URL, the runner's CPU, cores and memory. The generated apps don't run on CI: the [bench repo](https://github.com/push-based/ng-hybrid-preprocessor-bench) found that a 2-core runner's network disk adds more noise than the comparison can stand, and the Performance page's numbers come from one laptop.

## Noise, and what it can't tell you

- **It runs on a laptop, next to other work.** The published numbers come from a 12-core M2 Max on mains power, while other sessions on the same machine were building and testing. `--max-load` keeps samples out of the worst spikes, not out of all of them. Each sample records the load average when it started. Compare tools within a run, not runs across days.
- **The OS file cache is always warm.** Cold means every tool's own caches are gone, not the operating system's. A first start after a reboot would be slower for everyone.
- **Headless Chrome on the same machine.** The browser competes with the dev server for the same cores, as it does on a developer's laptop.
- **Edits are timed with the type-check running.** ngp's and the CLI's dev servers type-check after each edit, in the background. Back-to-back edits can overlap with the previous check.
- **Vite's watcher on macOS adds 10–115 ms to each edit.** A bare Vite server, no plugins, saw a write after either about 10–35 ms or about 113 ms, unpredictably. So every Vite toolchain's edit times are bimodal. The report shows each edit series' fastest sample next to its median for that reason.
- **Runs drift.** vite-plugin-ngp's cold start at 5,000 components measured 1.87 s in one run and 2.11 s an hour later. Rounds keep that drift equal across tools within one run.
- **One edit shape per kind.** A template edit that adds an element, and a class edit that changes a string. Other edits, like adding an import, can cost more.
