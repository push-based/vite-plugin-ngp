---
title: Testing with Vitest
description: Run Angular TestBed specs under Vitest, compiled AOT by vite-plugin-ngp one spec and its imports at a time, in Node on the server platform's DOM, on jsdom, or in a real browser.
---

# Testing with Vitest

vite-plugin-ngp runs your Angular specs under Vitest with TestBed. It compiles them ahead of time with ngp, the same way it compiles your app in the dev server. A run compiles only the specs you asked for and what they import: run one spec, and ngp compiles that spec's components, not the whole app. Specs run one of three ways: in Node on Domino, the DOM Angular renders with on the server, which is the default here; on jsdom; or in a real Chromium through Vitest's browser mode. Setup is the plugin in `vitest.config.ts` plus one setup file per way, and the playground runs its specs all three ways. An app from [`npm create @push-based/ngp`](vite-plus#create-a-new-app) comes with the server-platform setup below, and under Vite+ [`vp test`](vite-plus#the-toolchain-with-angular) runs it unchanged.

This page is for someone who already builds an app with the plugin and wants to test it. It covers the three setups, which to pick, what the plugin changes when Vitest runs it, and what hasn't been tried yet.

## Setup: Node on the server platform

Install Vitest. No DOM package: the specs run in Node, on the DOM Angular renders with on the server. The repo's playground uses this version:

```bash
pnpm add -D vitest@5.0.4
```

`ServerTestingModule` imports `@angular/platform-browser-dynamic/testing`, which `@angular/platform-server` doesn't list as a dependency. An app that renders on the server has it installed already; otherwise add it at your Angular version. npm prints a deprecation notice for it, which is Angular's: the package is deprecated for apps, and `ServerTestingModule` still imports it.

```bash
pnpm add -D @angular/platform-browser-dynamic@22.3.0
```

`vitest.config.ts`, next to your `vite.config.ts`:

```ts
import {defineConfig} from 'vitest/config';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp()],
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
});
```

Leave out `ssr`: the plugin ignores it under Vitest anyway.

`src/test-setup.ts` installs Domino's DOM as globals, starts TestBed on the server platform once per test file, and resets it after every test:

```ts
import '@angular/platform-server/init';
import {getTestBed} from '@angular/core/testing';
import {platformServerTesting, ServerTestingModule} from '@angular/platform-server/testing';
import {afterEach} from 'vitest';

getTestBed().initTestEnvironment(ServerTestingModule, platformServerTesting());

afterEach(() => getTestBed().resetTestingModule());
```

The first import matters. `@angular/platform-server/init` copies Domino's `Element`, `Node`, `Event` and the rest onto `globalThis`, the same way the server entry gets them, so a spec can write `new Event('click')` and `instanceof HTMLElement`. `document` and `window` stay undefined: each TestBed gets its own document, as each server render does.

Don't skip the `afterEach`. Angular would register that reset itself, but only when `afterEach` is a global, and Vitest's globals are off by default. Without it, every test in a file shares one TestBed, and the second `configureTestingModule` fails with "the test module has already been instantiated".

TestBed runs zoneless, Angular's default, so there's no `zone.js` import. Wait for rendering with `await fixture.whenStable()`.

If you keep a `tsconfig.spec.json`, the plugin reads your Angular compiler options from it under Vitest, and from `tsconfig.app.json` otherwise. Add a script:

```json
"test": "vitest run"
```

### Why the server platform

An app that renders on the server runs every component twice: once in Node on Domino, once in the browser. A spec on jsdom checks the browser half only. It passes on a component that reads `window` in its constructor, and the first `vite build` with `ssr: true` finds out. On the server platform the same spec fails where the component does, with the same error the server would give, so a green run means the component renders on both sides. That's the trade: Domino is a smaller DOM than jsdom, and the gaps below are the price.

It's also faster. Vitest builds a jsdom window per test file, and that was most of a warm run. On an M2 Max, measured on 6 November 2026, the playground's 11 tests take 0.58–0.61 s warm on Node, against 1.1–1.3 s on jsdom measured with the earlier setup.

An app that never renders on the server loses nothing by testing this way, but it can keep jsdom, or go to a real browser: [Setup: jsdom](testing#setup-jsdom) and [Setup: browser mode](testing#setup-browser-mode) have those, and [Which to pick](testing#which-to-pick) compares them.

## Writing specs

Specs are ordinary TestBed specs. The DOM is Domino's: query it, read it, click it and dispatch events on it as in a browser, with the few gaps in [Domino's gaps](testing#dominos-gaps). A component with a signal input and a two-way `model()`, from the playground:

```ts
@Component({
  imports: [Rating],
  template: `<app-rating [(value)]="score" [max]="4" /><output>{{ score() }}</output>`,
})
class Host {
  readonly score = signal(2);
}

it('writes a click back to the parent through [(value)]', async () => {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  fixture.nativeElement.querySelectorAll('app-rating button')[3].click();
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('output').textContent).toBe('4');
});
```

The host component is declared in the spec, and ngp compiles it ahead of time like any other component. A service spec needs nothing special: `TestBed.inject(ToastService)`, with `vi.useFakeTimers()` for its timeouts. Routed components work with `RouterTestingHarness` and your real routes, lazy `loadComponent` routes included:

```ts
TestBed.configureTestingModule({providers: [provideRouter(routes, withComponentInputBinding())]});
const harness = await RouterTestingHarness.create();
await harness.navigateByUrl('/router/signals');
```

TestBed overrides work too. `TestBed.overrideComponent(Rating, {set: {template: '...'}})` recompiles that one component with the JIT compiler, which `@angular/core/testing` always loads. ngp emits the class metadata that needs, in `ɵsetClassMetadata` calls, and they run because `ngDevMode` stays on in tests. An override of a component that imports an NgModule, such as `CommonModule`, needs [`test.jitCompat`](testing#specs-written-for-jit) as well.

The playground's specs are in its `src/` folder, next to the files they test: a component spec, a service spec and a routed spec, 11 tests in all. Its three setup files are in `src/testing/`, one per project.

## What the plugin does under Vitest

The plugin knows Vitest is running from the `VITEST` environment variable, and changes five things from how it works in the dev server. In browser mode, where Vite serves the specs to a browser, only the first, third and fifth apply: Angular's libraries are pre-bundled by Vite's dependency optimizer and linked there, as in the dev server.

**Specs compile on demand.** In the dev server, ngp's analyzer starts from `src/main.ts`. Under Vitest it starts from nothing. Vitest asks for a spec, the plugin compiles it, and the analyzer follows that spec's imports. So a run filtered to one file compiles only that file's dependency tree. To see it, set `DEBUG=vite-plugin-ngp`:

```bash
DEBUG=vite-plugin-ngp pnpm vitest run --project server src/app/pages/components/rating.spec.ts
```

```text
vite-plugin-ngp unchanged src/testing/server.ts (2.2 ms)
vite-plugin-ngp compiled src/app/pages/components/rating.spec.ts (20.3 ms)
vite-plugin-ngp compiled src/app/pages/components/rating.ts (15.4 ms)
vite-plugin-ngp compiled src/app/ui/icon.ts (2.5 ms)
```

That's 3 of the playground's 29 modules. All three specs together load 10. The repo has a test that checks the list for two filtered runs.

**Angular libraries get linked.** Vitest leaves `node_modules` to Node, which would load Angular's packages partially compiled, and they'd need the JIT compiler. The plugin adds every `@angular/*` package to `test.server.deps.inline`, plus every package in `dependencies` or `devDependencies` that depends on `@angular/core`. Vitest then sends them through Vite, where the linker runs. That also keeps one copy of `@angular/core`.

**Libraries are cached, your code isn't.** Vitest 5 caches transformed modules on disk, keyed by each file's own content. That's wrong for a component: its compiled code also depends on its template, its styles and the components it imports, so a template edit would come back stale. The plugin keeps your app's `.ts` files out of that cache. Linked libraries stay in it, and linking is the slow part. On an M2 Max, measured on 6 November 2026, the playground's 11 tests take 1.5 s with an empty cache, and 0.58–0.61 s after that. Since 9 November 2026 your own modules have a cache of their own, the plugin's, whose key covers the template, the stylesheets and the used components' public shape ([Reusing output between builds](how-it-works#reusing-output-between-builds)). A run compiles only what changed since the last one; the analyzer still looks at every module a run imports.

**No HMR, no SSR.** Compiled components carry no HMR code, and the `ssr` option is ignored. `ngDevMode` stays on, as in the dev server, and `ngJitMode` is `false`, unless [`test.jitCompat`](testing#specs-written-for-jit) is on. `ngServerMode` follows Vitest's environment: `true` under `node`, where Vitest runs specs in a server environment, undefined under jsdom, which Vitest treats as a client, and `false` in browser mode. So on the server platform Angular takes the same code paths it takes in `main.server.ts`, and in a browser the ones it takes in `main.ts`.

**Watch mode follows edits Angular cares about.** `vitest` without `run` reruns the specs that depend on what you saved. Edit a template, and the plugin tells Vitest its component changed, so that component's specs rerun with the new template. Edit a child component, and the parents that use it are compiled again too, so a renamed input fails the parent's spec with `NG8002: Can't bind to 'eyebrow'` instead of passing on stale code.

## Specs written for JIT

Specs written for Karma or Jest ran on the JIT compiler, which resolves a component's scope at runtime. Under the plugin they compile ahead of time, like the app, and a few things JIT allowed stop working. The `test` option turns back on what a suite like that needs, one switch at a time. Each switch applies under Vitest only, and is off unless you set it:

```ts title="vitest.config.ts"
ngp({test: {jitCompat: true}});
```

**`jitCompat`: TestBed overrides see NgModules.** `TestBed.overrideComponent`, `overrideModule` and `overrideTemplate` recompile a class with JIT, and JIT reads the scope of every NgModule the class imports. Ahead-of-time code drops those scopes: the linker strips them from libraries, and `ngJitMode: false` strips them from your own NgModules. So an overridden template that uses `*ngIf` from `CommonModule` renders nothing, with `NG0303: Can't bind to 'ngIf' since it isn't a known property of 'p'` on the console. With `jitCompat`, libraries are linked in JIT mode and `ngJitMode` is `true`, and the override works. It costs a little more linked code per NgModule, in specs only.

`jitCompat` also keeps `@defer` dependencies as static imports. Ahead of time, a component used only inside `@defer` becomes a dynamic import, and the component that defers it gets its decorator metadata asynchronously (`ɵsetClassMetadataAsync`). TestBed resolves that only in `compileComponents()`, so a spec that overrides the component without calling it fails with `Component 'Dashboard' has unresolved metadata`, and ng-mocks' `MockComponent()`, which reads the metadata at once, fails too. JIT loaded these dependencies eagerly, and with `jitCompat` so does the plugin. The `@defer` blocks themselves still work: placeholders, triggers, and stepping through states with `DeferBlockBehavior.Manual` and `fixture.getDeferBlocks()`. What a spec can no longer see is the lazy loading itself. ngp keeps dependencies static only when it compiles for HMR, so specs compile that way, and the plugin removes the HMR code that comes with it. It goes into the plugin's cache key, and into Vitest's for linked libraries, so turning it on or off never serves a module linked the other way. In browser mode it reaches Vite's dependency pre-bundling too.

Leave it off if no spec overrides a component that imports an NgModule: without it, specs run the code your app ships.

**`extendedDiagnostics: 'warning'`: extended checks warn instead of failing a spec.** Specs go through the same compiler as your app, so Angular's [extended diagnostics](type-checking#angulars-extended-diagnostics) run on them, which JIT never did. If your tsconfig sets `extendedDiagnostics.defaultCategory: "error"` for the build, an unused standalone import (NG8113) in a component fails every spec file that imports it, and the spec file runs no tests. With the switch, each one is a warning in the Vitest output, and the build and the dev server still report it as your tsconfig says. A check your tsconfig suppresses stays suppressed. The switch covers every check `extendedDiagnostics.checks` accepts, including the two outside the NG81xx range: `controlFlowPreventingContentProjection` (NG8011) and `deferTriggerMisconfiguration` (NG8021).

You may not need the switch. Under Vitest the plugin reads `tsconfig.spec.json` first, so `"extendedDiagnostics": {"defaultCategory": "warning"}` there does the same, without code. That stops working when a check is set to `error` on its own, under `checks`, since a single check wins over `defaultCategory`. The switch covers that case too. It changes only how a diagnostic is reported, not the compiled code, so it doesn't touch the cache.

**`runtimeScopes`: scope errors TestBed resolves at runtime are dropped.** Compiling one file can't see two scopes that only exist when a spec runs:

- A **non-standalone** component gets its scope from its NgModule, or from `TestBed.configureTestingModule({declarations: [...]})`.
- A component **declared in a spec file**, a test host, often gets its imports or its template from `TestBed.overrideComponent`.

For these, ngp reports NG8001 to NG8004 (unknown element, property, reference and pipe), and NG8008 (missing required input) for a test host whose real template comes from an override. Each one fails the spec file. With `runtimeScopes`, the plugin drops NG8001 to NG8004 in those two kinds of component, and NG8008 in spec-declared ones. A spec file is one named `*.spec.ts` or `*.test.ts`, as in Vitest's default `include`.

**Leave `runtimeScopes` off unless your specs need it.** These are real errors everywhere else, and the switch can hide a real one: an unknown element at runtime is only logged (NG0304) unless you set `errorOnUnknownElements` in `configureTestingModule`, so a misspelled selector in a non-standalone component can pass a spec. A standalone component outside a spec file keeps every error, switch or not. The switch changes what's reported, not the compiled code, so it doesn't touch the cache. If only a few specs need it, migrating their hosts to standalone components is the cleaner fix.

## Domino's gaps

Domino is the DOM `@angular/platform-server` renders with, and it implements what rendering needs, not what a browser has. Three things the playground's specs ran into, with what to write instead:

- **`querySelectorAll` with a plain tag or class selector returns a collection you can't spread.** Domino answers `querySelectorAll('a')` through `getElementsByTagName`, whose result has no `Symbol.iterator`; a selector with a combinator, like `'app-rating button'`, gets a real `NodeList`. `Array.from(root.querySelectorAll('a'))` works for both, and on jsdom.
- **`new MouseEvent('mouseenter')` has no type.** Domino's `MouseEvent` constructor ignores its arguments, so the event dispatches to nobody. `new Event('mouseenter')` reaches an `(mouseenter)` listener. `element.click()` dispatches a real click.
- **No layout, no `getComputedStyle`, no `IntersectionObserver`.** Nothing is measured on the server, so a component that needs those is a component you can't render on the server either, and the spec tells you.

`fixture.nativeElement.textContent`, `querySelector`, attributes, `classList`, `dispatchEvent` and `click()` work as in the browser.

## Setup: jsdom

For an app that only runs in the browser, jsdom gives it a browser-shaped DOM in Node, and it was the setup documented before 6 November 2026. Install it, set `environment: 'jsdom'`, and start TestBed on the browser platform:

```bash
pnpm add -D jsdom@30.1.2
```

```ts
import {getTestBed} from '@angular/core/testing';
import {BrowserTestingModule, platformBrowserTesting} from '@angular/platform-browser/testing';
import {afterEach} from 'vitest';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

afterEach(() => getTestBed().resetTestingModule());
```

Everything else on this page applies the same way.

## Setup: browser mode

Vitest's browser mode runs each spec file in a real browser that Playwright drives, so the DOM is Chromium's, with layout, `getComputedStyle` and every event a user can send. Install the provider and Playwright, and download a browser once:

```bash
pnpm add -D @vitest/browser-playwright@5.0.4 playwright
npx playwright install chromium
```

In `vitest.config.ts`, turn the browser on instead of naming an environment:

```ts
import {playwright} from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [ngp()],
  test: {
    setupFiles: ['src/test-setup.ts'],
    browser: {enabled: true, headless: true, provider: playwright(), instances: [{browser: 'chromium'}]},
  },
});
```

The setup file is the jsdom one: `BrowserTestingModule` and `platformBrowserTesting()`, on the browser's own DOM. Nothing in the specs changes. In this mode the plugin treats the run as a browser: Angular's libraries come pre-bundled and linked through Vite's dependency optimizer, as in the dev server, and `ngServerMode` is `false`.

On CI, install the browser before the tests. The repo's workflow runs `npx playwright install --with-deps chromium` on Ubuntu.

## Which to pick

The playground runs its 11 tests all three ways, with a [Vitest project](https://vitest.dev/guide/projects) per setup in one `vitest.config.ts`, so `vitest run` covers all three and `vitest run --project browser` one of them. Measured on an M2 Max on 6 November 2026, warm, as the median of three `vitest run --project` runs:

| Setup | DOM | Warm run | Catches |
|---|---|---|---|
| Node on the server platform | Domino | 0.42 s | Code that can't render on the server |
| jsdom | jsdom | 0.78 s | Most browser DOM use, no layout |
| Browser mode | Chromium | 0.85 s | Everything a browser does, layout included |

Pick the server platform if your app renders on the server, or might: it's the fastest, and it fails the way the server would. Pick browser mode when a spec needs layout, real focus handling or a browser-only API; it costs a browser download and about a second of startup per run. jsdom sits between the two, and is the right choice for a browser-only app whose specs already pass there. Nothing stops you running two or all three, as the playground does: the specs are the same files.

## Limits

- **Browser mode has been tried on Chromium only.** Firefox and WebKit should work the same way through Playwright, and happy-dom like jsdom, but nobody has run them.
- **No `fakeAsync`.** It needs `zone.js`, and the setup above is zoneless. Use Vitest's fake timers and `await fixture.whenStable()` instead.
- **No type-checking.** Vitest strips types without checking them, as Vite does. Template errors ngp finds, like the `NG8002` above, do fail the spec file, but type errors elsewhere in a spec don't. Run `tsc` on your specs separately.
- **Your code is analyzed again on every run.** The plugin's cache skips ngp's code generation for an unchanged module, but the analyzer still reads every module a run imports, to compute the key. In the playground compiling cost 2–20 ms per module before the cache; what a run saves on a large app hasn't been measured under Vitest.
- **Coverage hasn't been tried.** ngp returns source maps, so `@vitest/coverage-v8` should map back to your files, but nobody has checked.
