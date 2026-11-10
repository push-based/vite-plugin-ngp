---
title: Performance
description: How fast vite-plugin-ngp starts, updates and builds next to ng serve, Analog and @oxc-angular/vite, and how much memory each holds, measured end to end on apps of 100 to 5,000 components.
---

# Performance

On a 5,000-component app, vite-plugin-ngp shows the first page 1.6 seconds after you start the dev server, where `ng serve` takes 28.4 seconds. A template edit reaches the page in 100 to 130 ms, where `ng serve` takes 1.8 seconds and Analog reloads the page in 2.7 seconds. Neither grows much with the app, where the CLI's times grow with every component, and the plugin type-checks the whole time. Once the page is up after a restart, the plugin's dev server holds 0.9 GB where `ng serve` holds 4.7 GB. `@oxc-angular/vite` matches the plugin's typical template edit and is faster and lighter at everything else, but it uses its own compiler, doesn't type-check, and its builds don't split `@defer` blocks into their own chunks. Production builds are where the plugin gains least: 20 seconds against `ng build`'s 30, both type-checking, at about the same peak memory.

This page is for you if you're deciding whether to try vite-plugin-ngp instead of the Angular CLI or Analog, and want to know what you'd gain and what you'd give up. The apps here are generated; [Benchmarks on real apps](benchmarks) measures two open-source apps against their own CLI on GitHub's runners. Every number here was measured on one laptop on the evening of 17 October 2026, in one run of the benchmark in the repo's `bench/` folder, on the plugin at commit `e401c10`. Each figure shows the medians its table lists; the plugin's bar is violet, every other tool's gray. The last sections say how it was measured, and where these numbers are weak.

## What was measured

Four toolchains, each with its own README's setup and nothing else, on the same apps, with the same Angular, `22.3.0-next.2`, the version ngp was built from when this ran, plus the plugin a second time with its opt-in [`typeChecker: 'tsrs'`](type-checking#checking-with-tsrs), which swaps `tsgo` for Oxc's Rust port of TypeScript 7:

| Toolchain | Version | Type-checks? |
|---|---|---|
| vite-plugin-ngp | the repo at commit `e401c10` | yes: in a background process in dev, and before `vite build` finishes |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | the same, with tsrs 0.16.0-ts7.1.0-dev.20260929 | yes, the same check in tsrs |
| Angular CLI, `ng serve` and `ng build` | `@angular/build` 22.3.0-next.2 | yes, in both |
| Analog, `@analogjs/vite-plugin-angular` | 2.8.2-beta.1, with a one-line patch (see [below](performance#where-these-numbers-are-weak)) | no: `disableTypeChecking` is on by default |
| `@oxc-angular/vite` | 0.0.41 | no, by design |

The three Vite plugins ran on Vite 8.3.4. The apps are generated Angular CLI workspaces of 100, 1,000 and 5,000 components, the same ones the [ngp benchmark](https://github.com/push-based/ng-hybrid-preprocessor-bench) uses: standalone components with signals, control flow, `@defer`, pipes and directives, half of them with external templates. The fourth app is the repo's playground, 21 components. The Angular CLI can't run the playground, because it reads `import.meta.env`, which only Vite defines.

Each start and build ran once to warm up, then 5 measured times. Each edit ran twice to warm up, then 20 measured times. The tables show medians. A number marked ±N% varied by more than 5% from run to run, as median absolute deviation.

No number counts unless the app worked: the shell rendered every feature link and the first lazy route rendered its heading in headless Chrome, with no console errors, failed requests or exceptions. An edit counts only once the new content is in the DOM and still there 800 ms later. A build counts only if it boots and a second lazy route renders after a router navigation. Every one of these checks passed for every toolchain on every app. The one failure, in an earlier run, was Analog with its opt-in HMR turned on, described under [Template edits](performance#template-edits).

Memory was recorded for every start, edit series and build: the resident memory of the tool's whole process tree, sampled every 100 ms. The [Memory](performance#memory) section has it.

## Starting the dev server

From starting the process to the first contentful paint of the rendered app.

![Cold start to first contentful paint: medians of 5 runs per tool and app, one laptop, 17 October 2026.](charts/dev-cold.svg)

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 784 ms | 1.00 s | 1.64 s | 770 ms |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 778 ms | 949 ms | 1.57 s | 775 ms |
| `ng serve` | 2.06 s | 6.92 s | 28.4 s | n/a |
| Analog | 1.04 s | 1.94 s | 6.43 s | 1.08 s |
| `@oxc-angular/vite` | 359 ms | 532 ms | 1.09 s | 352 ms |

That's a cold start: every cache the toolchain keeps was deleted first. A restart keeps those caches, and is what you do every morning:

![Restart to first contentful paint, with the caches kept: medians of 5 runs.](charts/dev-warm.svg)

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 405 ms | 453 ms | 570 ms | 467 ms |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 399 ms | 451 ms | 539 ms | 463 ms |
| `ng serve` | 1.92 s | 6.82 s | 28.1 s | n/a |
| Analog | 909 ms | 1.74 s | 5.76 s | 948 ms |
| `@oxc-angular/vite` | 282 ms | 296 ms | 338 ms | 303 ms |

`ng serve` and Analog compile the whole program before the first page, so their start grows with the app. The CLI's cache barely helps a restart: 28.1 against 28.4 seconds. vite-plugin-ngp compiles only what the first page imports, so at 5,000 components it's 17 times faster than `ng serve` cold and almost 50 times faster on a restart. Which process runs the type-check makes no difference you can see here: the tsrs rows are within the run-to-run drift of the default ones on every app.

Most of the plugin's cold start is Vite pre-bundling Angular's packages, which a restart skips: 1.1 seconds of the 1.6 at 5,000 components. That step runs Angular's linker on every partially compiled package. When these numbers were taken it was the Babel linker. `@oxc-angular/vite` pays 0.75 seconds for the same step, so the slower linker probably cost the plugin about 0.3 seconds there. That's an inference from the two differences, not a measurement of the linker itself. Since 9 November 2026 the plugin links with Angular's linker over Vite's oxc parser instead, which is about three times faster on the same modules in a direct comparison ([How it works](how-it-works#linking-libraries)); the bench hasn't been rerun with it.

The plugin's background type-check was on for all of these, as it is by default. Since 17 October the first check waits until the dev server has gone idle, so it no longer competes with the first page ([Type-checking](type-checking#what-you-see)). In the afternoon run of the same day, before that change, the cold start at 5,000 components was 1.74 seconds against 1.64 here, and a back-to-back comparison on 16 October had put the check's cost to a cold start at about 150 ms. The two agree, but 100 ms is also the size of the drift between runs. A run on 18 October settled it: the plugin before and after the change, built as two packages and started in the same rounds on the 5,000-component app at a load under 4, painted cold in 1.84 against 1.70 seconds, every sample of the old plugin slower than every sample of the new, and restarted in 635 against 642 ms, which is inside the spread. A restart paints before the old one-second delay ever fired, so only the cold start had anything to gain ([Type-checking](type-checking#where-its-weak)).

## Template edits

From writing an external template to the new element in the page. "reload" means the toolchain reloaded the page to show it; every other edit updated the component in place. In brackets, the fastest edit.

![Template edit to the DOM: medians of 20 edits per tool and app, with the fastest edit marked by a ring.](charts/edit-template.svg)

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 97 ms ±30% (59 ms) | 119 ms (56 ms) | 109 ms ±23% (60 ms) | 129 ms (66 ms) |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 123 ms (60 ms) | 102 ms ±19% (58 ms) | 71 ms ±11% (61 ms) | 129 ms (65 ms) |
| `ng serve` | 183 ms (179 ms) | 459 ms (442 ms) | 1.81 s (1.76 s) | n/a |
| Analog, default | 329 ms (227 ms), reload | 789 ms (633 ms), reload | 2.72 s (2.54 s), reload | 229 ms ±15% (195 ms), reload |
| `@oxc-angular/vite` | 118 ms (16 ms) | 117 ms (15 ms) | 116 ms (16 ms) | 118 ms (16 ms) |

The plugin's time stays flat from 100 to 5,000 components, because an edit regenerates only the edited component's update. `ng serve` rebuilds, and its time grows to 1.8 seconds. Analog reloads the page by default, and its time grows with the app too.

The fastest edit matters here because of macOS. In a test with no plugin at all, Vite's file watcher noticed a write after either about 10–35 ms or about 113 ms, unpredictably. Every Vite toolchain's times have that in them, so each toolchain's edits cluster around two values, and a median depends on how many of a run's edits got the slow report. That's why the plugin's median at 100 components is 97 ms with a ±30% spread and 119 ms at 1,000, and why its tsrs row reads 71 ms at 5,000 components where the default reads 109: more fast reports in those series, not a faster tool. The fastest edits, in brackets, are the same 56 to 66 ms in every plugin series.

The rings show what the medians hide. The plugin's edits cluster around 60 ms and 120 ms, and `@oxc-angular/vite`'s, in the same run, around 16 ms and 118 ms. On a slow report the two tie. On a fast one, the plugin still waits: it holds a template update until 50 ms after the template was written, in case the same save also changes the component's class, and when the watcher reports within 10 ms about 40 ms of that window is left ([How it works](how-it-works#component-hmr)). Everything else, from the analyzer through ngp's update module to the message to the browser, takes about 5 ms. Until 17 October the wait counted from the watcher's report instead, and the plugin's edits clustered around 75 ms and 175 ms.

Analog's component HMR is off by default, and turning it on didn't work here, in a run on 16 October with the same Analog version. With `liveReload: true`, template edits on the playground updated in place in 262 ms (194 ms fastest). But on the generated apps, Analog logged an update for every template edit and the page never changed: the browser never asked for the component's new code. And on the playground, a `.ts` edit that changed a class field was sent as an update instead of a reload, so the page kept the old value. Those were the only checks that failed, so `liveReload: true` has no row in the tables.

## `.ts` edits

Changing a signal's initial value in the first route's page component. Every toolchain reloads the page for this, because a class change can't be applied to a running component.

![.ts edit to the DOM: medians of 20 edits, with the fastest edit marked by a ring.](charts/edit-ts.svg)

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 179 ms (77 ms) | 187 ms (85 ms) | 216 ms ±17% (125 ms) | 167 ms (65 ms) |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 181 ms (79 ms) | 185 ms (76 ms) | 210 ms (117 ms) | 140 ms ±21% (64 ms) |
| `ng serve` | 236 ms (228 ms) | 522 ms (508 ms) | 1.89 s (1.85 s) | n/a |
| Analog | 328 ms (218 ms) | 781 ms ±6% (627 ms) | 2.68 s (2.59 s) | 201 ms (192 ms) |
| `@oxc-angular/vite` | 167 ms (67 ms) | 171 ms (67 ms) | 180 ms (73 ms) | 162 ms (61 ms) |

The reload includes fetching and running every module the page needs again. The plugin and `@oxc-angular/vite` are within the watcher's noise of each other here.

## Type errors in the dev server

Only vite-plugin-ngp and `ng serve` type-check in the dev server. This times planting a template type error until the terminal names it, and then removing it until the terminal reports the app clean. The plugin is here twice: with `tsgo`, the default, and with tsrs.

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp, error shown | 496 ms | 638 ms | 1.36 s | 500 ms |
| vite-plugin-ngp, error cleared | 502 ms | 548 ms | 1.36 s | 498 ms |
| with tsrs, error shown | 484 ms | 557 ms | 1.02 s | 479 ms |
| with tsrs, error cleared | 483 ms | 500 ms ±6% | 1.02 s | 477 ms |
| `ng serve`, error shown | 182 ms | 433 ms | 1.66 s | n/a |
| `ng serve`, error cleared | 185 ms | 455 ms | 1.78 s | n/a |

The plugin waits 300 ms after an edit before it checks, so on small apps `ng serve` reports first. At 5,000 components the plugin's whole-program `tsgo` check takes about 1.4 seconds, a little faster than `ng serve`'s rebuild. Neither holds up the page: the plugin's template update arrives in about 110 ms, and the type error 1.4 seconds after the edit. With [`typeChecker: 'tsrs'`](type-checking#checking-with-tsrs) the same error shows in 1.02 seconds, a third less, and at 1,000 components in 557 ms against 638. On the small apps the two are within 20 ms, because there the 300 ms wait and the watcher's delay are most of the half second and the check itself is a tenth of it.

## Production builds

From starting `vite build` or `ng build` to the process exiting, with caches deleted first.

![Production build, process start to exit: medians of 5 builds per tool and app.](charts/build.svg)

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 1.32 s | 4.79 s | 20.5 s | 1.08 s |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 1.29 s | 4.65 s | 19.6 s | 1.07 s |
| vite-plugin-ngp, `typeCheck: false` | 1.16 s | 3.88 s | 16.7 s | 1.03 s |
| `ng build` | 2.01 s | 6.73 s | 30.2 s | n/a |
| Analog | 1.44 s | 4.51 s | 19.3 s | 1.22 s |
| `@oxc-angular/vite` | 262 ms | 441 ms | 1.45 s | 317 ms |

The fair comparisons are the plugin against `ng build`, since both type-check, and the plugin without type-checking against Analog and `@oxc-angular/vite`, which don't. Against `ng build`, the plugin is about a third faster. Without type-checking it comes in under Analog by 2.6 seconds at 5,000 components. `@oxc-angular/vite` builds 5,000 components in 1.4 seconds, about 12 times faster than anything else, because its compiler is Rust from end to end. ngp's analyzer is Rust too, but its code generation is Angular's template compiler, in TypeScript. In a build of the 5,000-component app without type-checking, profiled on 16 October, 14.6 of 16.6 seconds went to transforming modules, and Rolldown's rendering and minifying took the remaining 2. Rolldown's own timings put the plugin's build optimizer, which runs Babel on every module, at 3.6 seconds of that. The rest of the transform time is mostly ngp. The type-check adds another 3.8 seconds at 5,000 components with `tsgo`, and 2.9 with tsrs; it runs while Rolldown renders, so it's partly hidden.

Since 9 November 2026 a build also keeps what it compiled, and a second build with nothing changed skips ngp's code generation, the linker and the optimizer. The figures above are cold builds, with that cache deleted too. What a warm build saves was measured outside this harness, on a loaded laptop, and is on [How it works](how-it-works#reusing-output-between-builds): at 5,000 components without type-checking, 48 s cold against 16 s warm in that session.

## Bundle size

All the JavaScript a build writes, and the initial part: what `index.html` loads plus everything it imports statically, before any lazy route. Gzip at level 9, per file. The figures show the gzipped sizes; the table has the raw ones too.

![All the JavaScript a production build writes, gzipped, per tool and app: the output of the last of the 5 measured builds.](charts/bundle.svg)

![The initial JavaScript, gzipped: what the browser downloads before any lazy route.](charts/bundle-initial.svg)

| App | Toolchain | All JS | gzip | Initial JS | gzip |
|---|---|---:|---:|---:|---:|
| 100 | vite-plugin-ngp | 424 kB | 127 kB | 232 kB | 71 kB |
| 100 | `ng build` | 421 kB | 128 kB | 247 kB | 77 kB |
| 100 | Analog | 423 kB | 127 kB | 232 kB | 71 kB |
| 100 | `@oxc-angular/vite` | 499 kB | 131 kB | 343 kB | 104 kB |
| 1,000 | vite-plugin-ngp | 2,017 kB | 525 kB | 246 kB | 76 kB |
| 1,000 | `ng build` | 1,994 kB | 523 kB | 251 kB | 78 kB |
| 1,000 | Analog | 2,006 kB | 521 kB | 246 kB | 76 kB |
| 1,000 | `@oxc-angular/vite` | 1,961 kB | 381 kB | 356 kB | 109 kB |
| 5,000 | vite-plugin-ngp | 9,296 kB | 2,342 kB | 313 kB | 97 kB |
| 5,000 | `ng build` | 9,080 kB | 2,275 kB | 268 kB | 81 kB |
| 5,000 | Analog | 9,237 kB | 2,324 kB | 314 kB | 97 kB |
| 5,000 | `@oxc-angular/vite` | 8,570 kB | 1,506 kB | 422 kB | 129 kB |
| playground | vite-plugin-ngp | 403 kB | 135 kB | 354 kB | 115 kB |
| playground | Analog | 406 kB | 134 kB | 355 kB | 114 kB |
| playground | `@oxc-angular/vite` | 490 kB | 157 kB | 443 kB | 137 kB |

The plugin's output is within 3% of `ng build`'s in total, gzipped, at every size, because it runs the CLI's build optimizer on Angular's own compiler output. At 5,000 components its initial JavaScript is 16 kB larger gzipped than `ng build`'s. Analog's is the same size as the plugin's, and both bundle with Rolldown, so that's likely Rolldown's chunking rather than the compiler.

`@oxc-angular/vite`'s total looks a third smaller at 5,000 components, and that's not a saving. Its build doesn't give `@defer` blocks their own chunks: the deferred component's code sits in its route's chunk, so the build writes 892 files where the plugin writes 1,884, and fewer, larger files compress better. Its initial JavaScript is 33–46% larger than the plugin's on the generated apps, gzipped, and 19% on the playground.

The playground's builds carry the `$localize` runtime, about 20 kB, 8 kB gzipped, because its copy in the benchmark imports it the way `ng add @angular/localize` would, so that all three toolchains run the same code. The plugin's own `i18n` option drops it ([Internationalization](i18n)).

## Memory

The resident memory of each toolchain's processes, summed over its process tree and sampled every 100 ms: the Vite or CLI process plus what it spawned, which is esbuild, `tsgo`, Sass's Dart VM and worker processes, depending on the tool. Shared pages count once per process, so a sum is an upper bound. It's what `top` would add up, and the number a laptop runs out of. Headless Chrome isn't in it.

![Dev server memory after a restart, once the page had rendered and settled: medians of 5 runs.](charts/memory-dev.svg)

What the dev server held once the page had rendered after a restart, and in brackets its peak between the process start and that point:

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 360 MB (420 MB ±6% peak) | 551 MB (685 MB peak) | 932 MB (932 MB peak) | 336 MB (348 MB peak) |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 368 MB (368 MB peak) | 556 MB (563 MB peak) | 939 MB (939 MB peak) | 335 MB (347 MB peak) |
| `ng serve` | 784 MB (784 MB peak) | 1.81 GB (1.81 GB peak) | 4.67 GB (5.65 GB peak) | n/a |
| Analog | 452 MB (452 MB peak) | 615 MB (615 MB peak) | 1.34 GB (1.34 GB peak) | 480 MB (480 MB peak) |
| `@oxc-angular/vite` | 218 MB (218 MB peak) | 218 MB (218 MB peak) | 261 MB (261 MB peak) | 205 MB (205 MB peak) |

After the edit series, 44 edits in one session, and in brackets the peak during them:

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 321 MB (465 MB peak) | 517 MB (828 MB peak) | 1.67 GB (2.48 GB peak) | 319 MB (436 MB peak) |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 321 MB (420 MB peak) | 532 MB (673 MB peak) | 1.68 GB (2.01 GB peak) | 316 MB (414 MB peak) |
| `ng serve` | 861 MB (865 MB peak) | 1.85 GB (1.90 GB peak) | 6.07 GB (6.44 GB peak) | n/a |
| Analog | 476 MB (532 MB peak) | 1.08 GB (1.18 GB peak) | 3.52 GB (3.60 GB peak) | 480 MB (497 MB peak) |
| `@oxc-angular/vite` | 176 MB (229 MB peak) | 176 MB (225 MB peak) | 239 MB (263 MB peak) | 193 MB (219 MB peak) |

A cold start peaks higher for every tool, because Vite's pre-bundling and the CLI's first compile run then: 1.56 GB for the plugin at 5,000 components, 5.63 GB for `ng serve`, 2.01 GB for Analog and 977 MB for `@oxc-angular/vite`.

![Peak memory of a production build: medians of 5 builds.](charts/memory-build.svg)

| Toolchain | 100 | 1,000 | 5,000 | playground |
|---|---:|---:|---:|---:|
| vite-plugin-ngp | 644 MB | 1.46 GB | 4.77 GB ±7% | 624 MB |
| vite-plugin-ngp, `typeChecker: 'tsrs'` | 643 MB | 1.26 GB | 4.39 GB | 612 MB |
| vite-plugin-ngp, `typeCheck: false` | 610 MB | 1.32 GB | 3.76 GB | 566 MB |
| `ng build` | 779 MB | 1.50 GB | 4.61 GB | n/a |
| Analog | 672 MB | 1.12 GB | 3.39 GB | 648 MB |
| `@oxc-angular/vite` | 280 MB | 576 MB | 1.55 GB | 270 MB |

The dev server is where the difference is. `ng serve` holds the whole compiled program, so it grows with the app, to 4.7 GB at 5,000 components after a restart, 5.7 at its peak on the way there, and 6.1 GB after the edits. The plugin holds what the browser has asked for: 0.9 GB after a restart at 5,000 components, less than Analog's 1.3 GB for the same page without a type-checker, and 1.7 GB after the edits where Analog holds 3.5 GB. Both peak higher during the edits, the plugin at 2.5 GB and Analog at 3.6. The plugin's check runs again after each edit, and the harness doesn't separate its share from Vite's, but the tsrs row does: with tsrs the same edits peak at 2.0 GB, so about half a gigabyte of that peak is `tsgo`. `@oxc-angular/vite` holds a quarter of a gigabyte at every size, with no type-checker and a compiler that keeps no program.

Builds are even. The plugin's build of the 5,000-component app peaks at 4.8 GB against `ng build`'s 4.6, and 3.8 GB without the type-check, a little above Analog's 3.4. The gigabyte between those two plugin rows is `tsgo` checking the program next to Rolldown: the harness can't separate the two processes, but the type-check is the only difference between the rows. With tsrs the same build peaks at 4.4 GB.

## What it adds up to

If your app is large and you use `ng serve`, the dev server is where the plugin changes the most: a dev server that's ready in under 2 seconds instead of half a minute, template edits in a tenth of the time, and a fifth of the memory, with type-checking kept. If you use Analog, the plugin starts almost 4 times faster at 5,000 components and updates templates in place by default, where Analog reloads. Builds improve less: a third faster than `ng build` with the same output size and about the same peak memory. Checking with tsrs instead of `tsgo` changes none of that, and takes a third off the wait for a type error on a large app.

`@oxc-angular/vite` beats the plugin on every timing here except the typical template edit, where they tie, and holds a quarter of its memory. What you give up for that is Angular's own compiler, type-checking, and code-splitting for `@defer`. The plugin's output is Angular's compiler's output, byte for byte the same as a full ngp build.

## Where these numbers are weak

- **One laptop, with other work running.** An Apple M2 Max with 12 cores and 32 GB, on macOS 27, Node 26.12.0, headless Chrome 155. An idle virtual machine held one core for the whole run, and other development sessions' dev servers were on the same machine. Each start and build waited for the 1-minute load average to drop below 6, and samples recorded loads between 2.0 and 8.8. Waiting for the load keeps samples out of the worst spikes, not out of all of them, and starts and builds ran in rounds, one toolchain after another, so a drift lands on every toolchain in a table alike. Compare toolchains within a table, not with numbers from another run or machine: the same measurement drifts between runs, and this run's numbers differ from the afternoon run of the same day by a few percent either way, in both directions.
- **Generated apps.** They're realistic in shape, but they're not your app: no third-party libraries beyond Angular, no large stylesheets, a global stylesheet of a few lines. The playground is the only hand-written app, and it's small. [Benchmarks on real apps](benchmarks) has Super Productivity and Ghostfolio.
- **Cold means the toolchains' caches, not the operating system's.** The file system cache was warm for every run. A first start after a reboot would be slower for everyone.
- **One kind of edit each.** Adding an element to a template, and changing a string in a class. An edit that adds an import or a new component can cost more, and wasn't measured.
- **The watcher's noise is in every Vite number.** Up to about 100 ms per edit, on macOS. Linux uses a different watcher and wasn't measured here; the real apps ran on Ubuntu runners.
- **Memory is an upper bound.** Resident set sizes summed over processes count shared pages more than once, and a 100 ms sample can miss a shorter peak.
- **Analog was patched.** Its latest stable release, 2.8.1, can't build on Angular 22.3: its build optimizer calls a private `@angular/build` API that now needs an initialization call. 2.8.2-beta.1 adds that call, behind a version check that reads Angular's prerelease version as `NaN` and so still fails. A one-line `parseInt` patch fixes the check. On a stable Angular release, the beta should work unpatched. Not measured.
- **`@oxc-angular/vite` targets Angular 22.2.2.** It doesn't use Angular's compiler, so the Angular version only matters at runtime here, and every app rendered and passed every check.

## Run it yourself

The harness is in `bench/` in the repo, with a [README](https://github.com/push-based/vite-plugin-ngp/tree/main/bench) on how to run it: one command sets up the apps, one runs the benchmark, one prints these tables from its result files, and one draws the figures. The result files behind this page are in `bench/results/`, with the machine, versions, commit and load average of every sample.
