---
title: Compatibility
description: Which Angular, Vite, TypeScript and Node versions each release of vite-plugin-ngp accepts, and how each range was checked.
---

# Compatibility

This page says which versions the plugin accepts, and which of them were run. Read it before you install, and again before you move Angular.

## What the package accepts

These are the plugin's peer dependencies and its `engines` field, as its `package.json` declares them. Your package manager checks them on install.

| | Accepts | The repo runs on |
|---|---|---|
| Angular (`@angular/compiler`, `@angular/compiler-cli`, and `@angular/localize` if you use [i18n](i18n)) | `>=22.3.0-rc.0 <22.4.0` | `22.3.0-rc.0`, and the newest release in the range on every CI run |
| Vite | `^8.3.0` | 8.3.4 |
| TypeScript | `>=6.0 <6.1` | 6.0.3 |
| Node | `>=26.0.0` | 26 |
| tsrs, only with [`typeChecker: 'tsrs'`](type-checking#checking-with-tsrs) | `>=0.16.0-0` | `0.16.0-ts7.1.0-dev.20260929` |

Keep every `@angular/*` package in your app on one version. That's Angular's rule, not the plugin's: `@angular/compiler` writes instructions for the `@angular/core` of the same release.

## Angular, by plugin version

Each plugin release carries one ngp build, made from one Angular commit. The middle column is what that release installs with.

| Plugin | Angular it accepts | ngp built from |
|---|---|---|
| Later than 0.4.1 | `22.3.0-rc.0` up to, not including, `22.4.0` | `22.3.0-rc.0` |
| 0.4.0, 0.4.1 | exactly `22.3.0-rc.0` | `22.3.0-rc.0` |
| 0.3.0 | exactly `22.3.0-next.4` | `22.3.0-next.4` |
| 0.2.0 | exactly `22.3.0-next.2` | `22.3.0-next.2` |

## How the Angular range was checked

On 25 November 2026 the plugin was built once, and then run with the ngp build from the `22.3.0-rc.0` commit against each Angular release below: the plugin's own tests, the playground's specs under Vitest, and the playground's production build with server rendering and two locales.

| Angular | Plugin tests | Playground specs | Playground build |
|---|---|---|---|
| `22.3.0-next.4` | 85 of 145 pass | fail | fails |
| `22.3.0-rc.0` | 145 of 145 pass | 33 of 33 pass | builds |
| `22.3.0` | 145 of 145 pass in 22 of 25 runs, 144 in the other 3 | 33 of 33 pass | builds |

**The lower end is measured.** ngp imports names from `@angular/compiler` that first shipped in `22.3.0-rc.0`. On `22.2.7`, and on every `22.3.0` prerelease from `next.0` to `next.4`, loading ngp stops with `The requested module '@angular/compiler' does not provide an export named 'PotentialTopLevelReadsVisitor'` (`IndexerVisitor` on `next.0`).

**The upper end is a judgment.** `22.3.0` was the newest Angular release on the day of the run, so nothing above it has been tried. The range takes in the patch releases of 22.3 before they exist, because Angular keeps patches to fixes. It stops before 22.4 because `@angular/compiler` isn't a public API and ngp uses several dozen names from it. Both moves the plugin made inside the 22.3 prereleases broke something: one changed how the analyzer treats a file that comes back after a delete, the other made a type-check call async and added a cache the plugin had to clear.

## Where this is weak

- **One test failed in 3 of 25 runs on `22.3.0`.** The test starts a dev server in middleware mode and asks for a page, and it got a 404. It passed in all 11 runs on `22.3.0-rc.0`, and in 12 runs on its own on `22.3.0`. The cause isn't found, so it isn't known whether `22.3.0` or the load of the full test run is behind it. If your own server hosts Vite in middleware mode, try it before you rely on it.
- **A 22.3 patch can still break it.** CI runs the plugin's tests, the playground's specs and its build on the newest release in the range, on every change to the repo. Between an Angular patch and the next CI run, nobody has run that patch. If one fails for you, pin the last Angular this page lists as run, and [open an issue](https://github.com/push-based/vite-plugin-ngp/issues).
- **Two releases were run, on one app.** The playground is small. The [real apps in the benchmarks](benchmarks) ran on an exact prerelease, not across the range.
- **The scaffolder still writes `22.3.0-rc.0`.** `@push-based/create-ngp` pins the release the ngp build came from. A scaffolded app can move to any release in the range.
- **Vite, TypeScript and Node are ranges nobody swept.** The repo runs one version of each, the one in the table.
