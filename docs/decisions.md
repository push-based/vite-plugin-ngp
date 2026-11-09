# Decision log

Each entry records one choice: what we decided, why, what it costs, and when to look at it again. Newest at the bottom. When a decision changes, add a new entry that replaces the old one and mark the old one superseded, instead of editing it. [design.md](design.md) describes the result as a whole.

## 1. Build on ngp, not on ngc or a reimplementation

*16 October 2026*

**Decision.** Compile Angular with ngp's `HybridCompiler`, Angular's own analyzer and template compiler.

**Why.** ngc can't compile one file without a whole `ts.Program`, which is the root of most of Analog's workarounds. Reimplementations like Analog's `fastCompile` and `@oxc-angular/vite` compile per file, but they skip template type-checking and match Angular's output only partly. Analog's own docs say "87%+". ngp gives per-file compilation with output identical to a full build.

**Cost.** ngp is an unpublished prototype that doesn't accept outside issues or pull requests.

**Revisit when** Angular publishes ngp, or changes its API.

## 2. Optimize mode only, in dev and in production

*16 October 2026*

**Decision.** Always create the analyzer and compiler with `optimize: true`.

**Why.** In local mode, compiling per file changed the output of 745 of 1,089 modules in the bench's lazy-start spike. Components lost `OnPush`, and `@defer` dependencies became dynamic imports. Losing `OnPush` changes how the app behaves at runtime. Optimize mode matched a full build for every module.

**Cost.** The analyzer's whole-program queries (`ComponentMapping`, `ProgramFiles`) run again after edits.

**Revisit when** local mode matches optimize mode when files are compiled one at a time.

## 3. Skip the delta pass and let Vite's module graph decide what to regenerate

*16 October 2026*

**Decision.** On an edit, call the analyzer's own `updateFileContent`, drop the stale files from ngp's cache, and invalidate them in Vite's module graph. Never call `HybridCompiler.updateFileContent` or `analyzeOptimizedDelta`.

**Why.** The delta streams every file in the program again after each edit: 465 ms at 5,000 components. The analyzer's stale set over-approximates, marking 202 files when 1 or 2 changed. Vite asks again only for the modules the page still uses.

**Cost.** The plugin depends on `HybridCompiler.fileCache` and the analyzer object, which are below ngp's intended API.

**Revisit when** ngp offers an update that doesn't run the delta.

## 4. Give the analyzer a tsconfig that lists only the entry points

*16 October 2026*

**Decision.** Write `tsconfig.entry.json` into Vite's cache directory. It extends the user's tsconfig, sets `files` to the entries and `include` to `[]`. The analyzer reads that one. Compiler options still come from the user's tsconfig. `entryOnlyTsconfig: false` turns it off.

**Why.** After every update, the analyzer reloads its tsconfig and re-expands the `include` globs: 172 ms per edit at 5,000 components, against about 1 ms with only `files` to resolve. The output was identical in the bench's spike.

**Cost.** Files that no entry imports, directly or indirectly, are invisible to the analyzer. New files work: the analyzer finds them through imports ([decision 25](#25-tell-the-analyzer-about-deleted-files-with-invalidatefiles)). Same output is checked only on the playground ([test](../packages/vite-plugin-ngp/test/entry-tsconfig.test.mjs)), not on a large app.

**Revisit when** Angular re-resolves entry points only when files are added or deleted. The code marks this `TODO(parity)`.

## 5. Load ngp from the bench repo's toolchain build

*16 October 2026. Superseded by 14.*

**Decision.** The plugin imports ngp from a directory set by the `toolchain` option or `NGP_TOOLCHAIN`. The playground defaults to `../ng-hybrid-preprocessor-bench/toolchain/out`.

**Why.** ngp isn't on npm. The bench repo already builds it from a pinned commit without Bazel, and its golden tests pass on all three engines. A second build pipeline here would just duplicate it.

**Cost.** Two repos have to be checked out side by side, and ngp resolves `@angular/compiler` from the bench repo's `node_modules`, not this one's. Both are pinned to `22.3.0-next.2`, so for now they're the same version.

**Revisit when** we want anyone outside push-based to try the plugin. Then we either vendor prebuilt binaries per platform or wait for Angular to publish ngp.

## 6. Native engine by default, with no silent fallback

*16 October 2026*

**Decision.** `engine` defaults to `native`, and the plugin passes that engine's path explicitly. `wasm` is opt-in.

**Why.** ngp's loader falls back from native to wasm by itself. The bench measured wasm at up to twice native's time, so a silent fallback would make every measurement misleading.

**Cost.** Platforms without a native build have to set `engine: 'wasm'` themselves.

## 7. Target Vite 8 and its Environment API only

*16 October 2026*

**Decision.** Peer dependency `vite ^8.3.0`. Use the `hotUpdate` hook and `transform` hook filters, not `handleHotUpdate` and `server.moduleGraph`.

**Why.** Vite 8 is current, and `@oxc-angular/vite` requires it too. Analog's use of the older hooks is one of its listed problems with environments.

**Cost.** Projects still on Vite 7 or earlier can't use the plugin.

## 8. Pin Angular to exactly 22.3.0-next.2

*16 October 2026*

**Decision.** Every `@angular/*` dependency is pinned to `22.3.0-next.2`, the release built from ngp's commit `92e5aa8`.

**Why.** ngp's backend imports compiler-cli's private `hybrid_analysis` API, which has to come from the same commit.

**Cost.** Moving to a newer Angular means rebuilding ngp at that commit and updating every pin together.

## 9. JIT fallback in the playground until there's a linker

*Superseded by 12.*

*16 October 2026*

**Decision.** The playground's `main.ts` imports `@angular/compiler`, so the runtime can finish compiling Angular's partially compiled packages in the browser.

**Why.** It got an app running from start to finish before building the linker, which is a known piece of work (the CLI's oxc-based linker is the reference) and not a question about ngp.

**Cost.** The compiler ships to the browser, and the playground's production bundle is 1.2 MB. Libraries' startup in dev doesn't reflect what an AOT build would do.

**Revisit when** the linker lands. This entry gets superseded then.

## 10. Private repo in the push-based org

*16 October 2026*

**Decision.** The code lives at `push-based/vite-angular`, private, like the bench repo.

**Why.** The bench repo is private, and the plugin depends on its unpublished toolchain.

**Revisit when** we publish the bench results or the plugin.

## 11. Node 26

*16 October 2026*

**Decision.** `.nvmrc` pins Node 26.12.0, and both `package.json` files require `>=26.0.0`.

**Why.** We chose to run on the newest Node line. Angular's CLI and ngp both accept it: their `engines` field allows `>=26.0.0`.

**Cost.** The bench repo still pins Node 24, so ngp is built under 24 and run under 26 here. That works because the native engine is an N-API addon, and N-API is stable across Node versions. The plugin test, `vite build` and the dev server all pass on 26.12.0.

## 12. Link libraries with Angular's Babel linker

*16 October 2026. Replaces 9. Superseded by 63.*

**Decision.** The plugin runs `createEs2015LinkerPlugin` from `@angular/compiler-cli/linker/babel` on every `node_modules` module that contains `ɵɵngDeclare`, except `@angular/core` and `@angular/compiler`. It runs as a Rolldown plugin in `optimizeDeps.rolldownOptions` for dev pre-bundling, and as a `transform` for builds and for deps that aren't pre-bundled. The playground no longer imports `@angular/compiler`.

**Why.** It's Angular's public linker API, and the bench's bundled builds already boot with it. Without a linker, every partially compiled library needs the JIT compiler in the browser. The playground's production bundle went from 1,197 kB to 589 kB.

**Cost.** Babel is slower than the oxc-based linker the CLI moved to (angular/angular-cli#33625). That costs time once per dependency in dev, because Vite caches pre-bundled deps, and once per build. The `@babel/core` dependency adds install weight.

**Revisit when** cold dev start or build time shows linking as a real share. The CLI's oxc linker is in `@angular/build`'s private API.

## 13. Define Angular's compile-time globals

*16 October 2026*

**Decision.** Define `ngJitMode: false` everywhere, `ngDevMode: false` in builds, and `ngServerMode: false` in the client environment, matching what `@angular/build` sets for a browser build.

**Why.** Without `ngDevMode: false`, a production build ran Angular's dev-mode checks and logged "Angular is running in development mode". With these globals the playground bundle shrank from 589 kB to 386 kB, because the minifier drops the dev-only and JIT branches.

**Cost.** `ngJitMode: false` breaks any code that compiles components at runtime. That's rare in apps, and it's the CLI's default for AOT builds too.

## 14. Build ngp in this repo

*16 October 2026. Supersedes 5.*

**Decision.** `toolchain/` builds ngp from the Angular commit in `versions.env`, into `toolchain/out`, with one command: `pnpm toolchain`. The playground and the tests read it from there, and `NGP_TOOLCHAIN` still overrides it. The scripts are the bench repo's, minus what only the benchmark needs: the sidecar engine, hyperfine, and the patches for phase timings and golden tests. A prerequisite check runs first, and CI runs the whole build on a clean Ubuntu machine for every push.

**Why.** Anyone given this repo should be able to build and run everything from it alone. Depending on a second private repo checked out next to it was a setup step nobody could guess from this repo.

**Cost.** The two repos' build scripts can drift apart, and a first build takes about 2 minutes on a 12-core M2 Max because it installs Rust and compiles both engines. ngp's backend now resolves `@angular/compiler` from this repo's `node_modules`, which removes decision 5's cross-repo dependency.

**Revisit when** Angular publishes ngp. Then `toolchain/` goes away and the plugin depends on `@angular/compiler-cli/preprocessor`.

## 15. Component HMR for external template edits only

*16 October 2026. Superseded by 23. Narrowed by 22.*

**Decision.** Only an edit to a component's external template is applied in place. Any edit to a `.ts` file reloads the page, even one that only touches the decorator's inline `template` or `styles`.

**Why.** An update module replaces a component's definition, but its dependencies come from the module that's already running. A template edit can't change those dependencies. A `.ts` edit can: a new entry in `imports` needs a component the running module doesn't have, and a selector change alters parent components' output. The CLI decides this with its own analysis of what changed. Reloading for every `.ts` edit is always correct, so it's the safe first version.

**Cost.** Inline templates and inline styles reload, which is most of the playground's components. External styles can't use HMR yet either, because the plugin doesn't handle them.

**Revisit when** we can tell that a `.ts` edit only changed the decorator's `template` or `styles`. ngp's metadata includes the decorator span (`removalSpans`) and `component.argsSpan`, which is a starting point.

## 16. Stop Vite's page reload with an untransformed template node

*16 October 2026*

**Decision.** For a template edit handled by HMR, `hotUpdate` returns `ensureEntryFromUrl(templateUrl, false)`: a module node for the `.html` file that Vite has never transformed.

**Why.** Vite's docs say a hook can return `[]` and send its own event. For a `.html` file in the client environment, though, Vite treats no modules as a page change and reloads. Vite stops propagation at a node whose `isSelfAccepting` is still undefined, because it hasn't been analyzed. That gives "handled, nothing to reload".

**Cost.** It depends on undocumented propagation behavior in Vite 8.3. If Vite changes it, template edits will reload again, with nothing failing loudly. The playground HMR check would catch that.

**Revisit when** Vite offers a supported way to mark a `.html` file as not a page, or on every Vite minor upgrade.

## 17. One ngp compiler per environment consumer

*16 October 2026*

**Decision.** The plugin keeps one compiler for the browser and one for server environments. Only the browser's compiles with `enableHmr`.

**Why.** HMR code runs at module load and imports `<module dir>/@ng/component?c=<id>`. On the server that's a `file://` URL that doesn't exist, so with one shared compiler every component failed to load its update module during SSR. ngp sets `enableHmr` when the compiler is created, so one compiler can't produce both outputs.

**Cost.** Two Rust analyzers in a dev server with SSR: about twice the analyzer memory, and every edit is analyzed twice. The server compiler starts only when something is rendered on the server.

**Revisit when** ngp can turn HMR output on per `processFile` call.

## 18. Bundle @angular/* in server environments

*16 October 2026. Partly superseded by 20, which widens what's bundled; 54 caches the bundled libraries in dev.*

**Decision.** Server environments set `resolve.noExternal: [/^@angular\//]` and define `ngServerMode: true` and `ngHmrMode: false`.

**Why.** Vite externalizes `node_modules` on the server by default. Node then loads Angular's packages unlinked, and a second `@angular/core` copy appeared next to the one the app used, so rendering failed with `NG0203`. Bundling them sends them through the linker and keeps one copy.

**Cost.** Angular's packages are transformed on every dev server start, not loaded straight from disk. Third-party Angular libraries outside `@angular/` are still externalized, so they'd load unlinked. Each one has to be added to `resolve.noExternal` until the plugin finds them itself.

## 19. Render pages in the plugin, behind a `render(url, document)` contract

*16 October 2026*

**Decision.** With `ssr` on, the plugin's dev middleware renders every page request through the server entry's default export. In production, the app serves `dist/` itself. The playground uses a 46-line `node:http` server.

**Why.** Without the middleware, every app would have to write Vite's custom-server setup (`middlewareMode`, module runner, `transformIndexHtml`) to see SSR in dev. A function from URL and document to HTML is the smallest contract that `renderApplication` fits and that any Node server can call. Production servers vary too much (Express, Fastify, edge runtimes) for the plugin to pick one.

**Cost.** No status codes, headers or redirects: the contract returns a string. `@angular/ssr`'s `AngularNodeAppEngine` handles those, and it expects the CLI's build manifest, which this plugin doesn't produce.

**Revisit when** an app needs status codes or redirects, or route-level render modes and prerendering.

## 20. Bundle every Angular library on the server, found from package.json

*16 October 2026. Widens 18.*

**Decision.** Server environments bundle `@angular/*`, plus every package the app depends on that depends or peer-depends on `@angular/core`. The plugin finds those by walking `package.json` files from the app's `dependencies`, following each Angular library's own dependencies too.

**Why.** Material, NgRx and in-house UI kits ship partially compiled, just like Angular's own packages. With only `/^@angular\//` bundled, Node would load them on the server unlinked, and rendering would need the JIT compiler. A dependency on `@angular/core` is the one thing every Angular library declares.

**Cost.** Only `dependencies` count, not `devDependencies`, so an Angular library listed under `devDependencies` stays external. The walk reads a few `package.json` files per server start. A library that imports Angular without declaring it would be missed. That's a broken package, but the user can still list it in `resolve.noExternal`.

## 21. Publish the docs as an Angular SSR site built with the plugin

*16 October 2026*

**Decision.** The user docs live in `site/`: an Angular app compiled by vite-plugin-ngp with `ssr: true`, prerendered to static HTML by `site/scripts/prerender.mjs`, hydrated in the browser, and deployed to GitHub Pages at https://push-based.github.io/vite-plugin-ngp/ on every push to `main`. Pages are markdown in `site/content`, compiled to HTML at build time with marked and Shiki. The look is the PushBased design system's tokens and `.pb-*` classes. `CLAUDE.md` and the README require every user-visible change to update the matching page in the same commit.

**Why.** Building the docs with the plugin makes the site a second real app, next to the playground: every deploy runs per-module compilation, linking, the server build and hydration from a clean machine. Static prerendering is what Pages can host. Compiling markdown at build time keeps marked and Shiki out of the browser bundle.

**Cost.** The site is public while the repo is private, so its GitHub links only work for push-based members. Every deploy builds ngp, which takes minutes when the Rust cache is cold. Prerendering uses `renderApplication` directly, not `@angular/ssr`, so the script, not Angular, decides which routes exist.

**Revisit when** the repo goes public, or Angular publishes ngp and deploys no longer need to build it.

## 22. Wait 50 ms before template HMR, and reload if the class changed too

*16 October 2026. Narrows 15. Superseded by 35.*

**Decision.** The plugin sends a template update 50 ms after the template changed, not right away. If the component's `.ts` file changed within 50 ms of the template, before or after it, the plugin sends no update and lets the `.ts` change reload the page. The plugin's `watchChange` hook records when each file changed. The client's `hotUpdate` returns at once and decides in the background.

**Why.** One edit often touches both files: a save-all, a `git checkout`, a rename of a field used in the template. Vite handles each file's change on its own, in whatever order the watcher reports them. When the template came first, its update module ran against the class still on the page. Renaming `loadedMs` in the playground's overview page threw `ctx.loadedAt is not a function`, Angular sent `angular:invalidate`, and the plugin reloaded. The result was right, but every combined edit cost a failed update and an error in the console. When the `.ts` came first, the template update could still reach the page before its reload did. Comparing the analyzer's copy of the `.ts` file with disk would only catch the template-first order, and only if both writes had landed. Timestamps catch both orders. The first version waited inside `hotUpdate`. Vite runs the server environment's `hotUpdate` only after the client's returns, so the server compiler got the new template 50 ms late. The `.ts` reload's server render then threw `ctx.loadedMs is not a function`.

**Cost.** Every template edit reaches the browser 50 ms later. Two writes more than 50 ms apart still count as two edits, so a slow tool that writes the template first gets the old failed update and reload. The window is a guess at how close one save writes its files. It wasn't measured across editors.

**Revisit when** `.ts` edits can be applied in place (see 15). Then the plugin would send one update for both files instead of reloading.

## 23. Update inline templates and styles in place, with the CLI's rules

*16 October 2026. Supersedes 15.*

**Decision.** When a component's `.ts` file changes, the plugin parses the old and the new content with TypeScript and compares them the way `analyzeFileUpdates` in `@angular/build` does ([hmr-candidates.ts](../packages/vite-plugin-ngp/src/hmr-candidates.ts)). Every top-level statement has to be textually identical, leading comments included, except inside a component class. There, the name, modifiers, `extends`/`implements` and members have to be identical too, the class has exactly one decorator, and only the values of `template` and `styles` may differ in it. If that holds, the plugin emits an update module for each component whose values changed and sends `angular:component-update`, as it does for external templates. Any other difference reloads the page.

**Why.** It answers decision 15's question with the rules Angular's own dev server already ships, so an inline edit behaves here the way it does under `ng serve`. A textual comparison can't be fooled by a change it doesn't understand: `imports`, `selector`, an input, a method or a top-level constant all differ as text, so they all reload. ngp's metadata wasn't enough on its own: its `argsSpan` and `removalSpans` describe only the file the analyzer has now, not the one before the edit, and they say nothing about statements outside decorators. The analyzer still decides which classes are components.

A template and its `.ts` file saved together still go through decision 22's 50 ms wait. If the `.ts` change was applied in place, the class on the page is unchanged, so the template update goes out too, after the `.ts` update. The page gets both without a reload. If the `.ts` change reloads, the template sends nothing, as before.

**Cost.** Being textual makes it strict. Reformatting a method, or a comment inside a class, reloads even though nothing changed. So does a template kept in a constant outside the decorator, like the playground's `encapsulation.ts`, and any component with a second decorator. Each `.ts` edit is parsed twice more, outside ngp; that's not measured, but it's one file. The CLI also updates in place when `templateUrl`, `styleUrl` or `styleUrls` change, and the plugin doesn't yet, because pointing a component at another file hasn't been tried with ngp's analyzer.

**Revisit when** ngp exposes its own "what changed" answer for an edit, or when external styles become Vite modules and `styleUrl` edits need the same treatment.

## 24. Port the CLI's build optimizer, in builds only

*16 October 2026*

**Decision.** `vite build` runs a copy of the oxc-based pass from `@angular/build` (`src/tools/oxc/oxc-transform.js` at `22.3.0-next.2`) on every module that mentions `ɵ`, `InjectionToken` or decorator metadata: the app's own code after Vite strips its types, and library code after the linker ([optimizer.ts](../packages/vite-plugin-ngp/src/optimizer.ts)). It wraps classes with Angular static members, and TypeScript enums, in IIFEs marked `/*#__PURE__*/`. In `@angular/*` packages that declare `"sideEffects": false` it marks every top-level call and `new` pure, and elsewhere only `new InjectionToken(...)`. It replaces `ɵsetClassMetadata` calls inside their wrappers with `void 0`, and removes `ctorParameters`, `decorators` and `propDecorators` assignments. `forwardRef` is pure through Rolldown's `treeshake.manualPureFunctions`, which is what the CLI passes to esbuild as `pure`. The pass parses with Vite's own oxc parser (`parseSync`) and edits with magic-string. The dev server never runs it.

**Why.** Rolldown already drops an unused expression marked pure, but nothing in Angular's output tells it which expressions are. A class with `static ɵcmp = ɵɵdefineComponent(...)` has a call in a static initializer, so Rolldown keeps every component, pipe and service it has seen, used or not. Rolldown has no option that covers this. `manualPureFunctions` takes function names, not "every top-level call in this package", and nothing makes a class with side-effecting statics removable. So the rewrites have to happen in a transform, and the CLI's is the one Angular's packages are tested against.

Measured on the playground's client build, with the same script for every row (JavaScript on the first page, then all JavaScript, in kB, gzip level 9 in brackets):

| | First page | All JS |
|---|---|---|
| Before | 502.2 (158.4) | 551.5 (178.6) |
| After | 315.7 (99.1) | 389.9 (128.7) |
| `ng build` of the same app | 335.6 (108.5) | 383.1 (128.7) |

The docs site, the other app built with the plugin, went from 461.9 kB (143.3 gzip) to 297.5 kB (92.8) on its first page. The pass runs on server bundles too, where the playground's JavaScript went from 1,492 kB to 1,172 kB.

The halves need each other. Marking top-level calls pure alone gives 418.6 kB on the playground's first page, wrapping classes alone 442.1 kB, and both together 315.7 kB: a pure call that references a class still keeps it, if the class itself looks side-effecting, and the other way round. Enums are worth 4 kB. The metadata removal saves nothing here, because `ngDevMode: false` (decision 13) already lets the minifier drop those calls. It stays because it's part of the CLI's pass and costs nothing.

The `ng build` row is the playground copied into a CLI project with an `angular.json`, minus the server entry and the CSS import in `main.ts`, built with `@angular/build` `22.3.0-next.2`. All JavaScript is within 2% raw and equal gzipped. The first page is smaller here because Rolldown splits chunks differently from esbuild, not because less code ships.

**Cost.** It's a copy of someone else's code. When the CLI changes its pass, this one doesn't follow until someone ports the change. Marking every top-level call in Angular's packages pure trusts that none of them is there for its side effect. The CLI trusts the same thing, so a package that broke it would break `ng build` too. Third-party libraries such as NgRx get the class wrapping but not the top-level marking, as under the CLI. The pass takes about 0.2 s over the 1.8 MB of Angular's own packages. Whole builds didn't get slower, because the minifier then has less code to work on. That was measured on the playground only.

**Revisit when** `@angular/build` exports its optimizer, or Rolldown can mark a package's top-level code pure. Then the plugin should call that instead of keeping a copy.

## 25. Tell the analyzer about deleted files with invalidateFiles

*16 October 2026*

**Decision.** When a `.ts` or `.html` file is deleted, the plugin calls `analyzer.invalidateFiles` for it instead of `updateFileContent`, and invalidates every importer of the file in Vite's module graph. A file counts as deleted when it can't be read, whatever event the watcher reported. After compiling a component, the plugin reports NG2008 for every `templateUrl` file that doesn't exist. And when a component's last compile failed, an edit to its template or inline template reloads the page instead of updating in place.

**Why.** The plugin used to ignore deletes. The analyzer keeps every file sent with `updateFileContent` in an in-memory overlay and never drops it, so after a delete it went on compiling importers against the deleted content, and Vite kept serving the importers' cached output: no error at all. `invalidateFiles` is the only call that drops the overlay. In ngp at `92e5aa8` it treats created, deleted and changed files alike, so the plugin uses it only for deletes and keeps `updateFileContent` for the rest. In the tests the analyzer's stale list did include the importers, but the plugin invalidates Vite's importers as well, so the error doesn't depend on that list being complete. Disk decides instead of the event type because on macOS, chokidar reported newly created files as `change` in the tests. The NG2008 check exists because ngp compiles a missing template to an empty one without a diagnostic, even in a fresh compiler. A deleted template would otherwise give a blank component. The reload after a failed compile is needed because the failed component isn't running in the browser, and an update sent to it changes nothing on the page.

[file-changes.test.mjs](../packages/vite-plugin-ngp/test/file-changes.test.mjs) covers new components, deletes, renames, deleting a file that's still used, and new, deleted and repointed templates. It runs a real dev server and Vite's watcher, and checks against a fresh compiler. Run against the plugin before this change, four of its eight fail: the three that delete a file, and the `templateUrl` test, which points a component at a template before the file exists. Changing `templateUrl` to another file works too: the analyzer moves the component to the new template, and only edits to the new one update it. That's the case decision 23 hadn't tried. A `templateUrl` change still reloads, as decision 23 says.

**Cost.** One more private analyzer call, `invalidateFiles`, typed by hand. The NG2008 check reads the analyzer's metadata after every component compile. That cost isn't measured, but the analyzer has the metadata cached by then. The check is the plugin's, not Angular's, so its message can differ from ngc's in edge cases. Missing `styleUrl` files aren't checked.

**Revisit when** ngp reports a missing template itself, or drops its overlay on `updateFileContent` for a file that's gone.

## 26. Compile specs on demand under Vitest, with no analyzer entries

*16 October 2026*

**Decision.** When `VITEST` is set, `entries` defaults to none, the analyzer's generated tsconfig lists no files, and `tsconfig.spec.json` comes first. Vitest asks for each spec, and ngp compiles it and whatever it imports as Vitest requests them. HMR and SSR are off.

**Why.** Analog compiles the whole program before the first spec runs, so a run filtered to one spec still pays for every component (analogjs/analog#2325, #2589). ngp's analyzer reads a file the first time `processFile` asks for it, even one no entry reaches. Compiling every playground module with no entries gives the same output as with every file in the program ([test](../packages/vite-plugin-ngp/test/entry-tsconfig.test.mjs)). Spec files need no special handling either, which decision 4 had left open: nothing imports them, and they compile anyway. Filtered to the rating spec, ngp compiles 3 of the playground's 29 modules.

**Cost.** Same output with no entries is checked only on the playground's 33 files. Optimize mode's whole-program queries see only the files read so far, so a difference would show up in components whose output depends on files the spec doesn't import. None did here. Detecting Vitest from `VITEST` means `vite --mode test` doesn't count as a test run, which is intended.

**Revisit when** a spec compiles differently under Vitest than in the dev server.

## 27. Inline Angular libraries under Vitest, and keep app modules out of its module cache

*16 October 2026*

**Decision.** Under Vitest, the plugin adds `test.server.deps.inline`: every `@angular/*` package and every Angular library in `dependencies` or `devDependencies`, as file-path patterns. It registers a `defineCacheKeyGenerator` callback that returns `false` for the app's `.ts` modules, so Vitest 5's on-disk module cache never stores them. Linked libraries stay in it.

**Why.** Vitest leaves `node_modules` to Node by default, which would load Angular's packages partially compiled. Inlining sends them through the linker and keeps one copy of `@angular/core`. Vitest's cache keys a module by its own content, but a compiled component also depends on its template, its styles and the components it imports, so an edited `.html` file would have come back as the old component. Caching linked libraries is what makes a warm run fast: the playground's 11 tests take 1.1–1.3 s warm against 2.1–2.5 s with an empty cache.

**Cost.** App modules are compiled again on every run, 2–20 ms each in the playground. String patterns were the obvious choice and were wrong: Vitest matches them by substring, so `@ngrx/store` would also inline `@ngrx/store-devtools`. Inlined libraries go through Vite's transform on a cold run, which is slower than Node loading them.

**Revisit when** Vitest's key callback can be async, or ngp can say which files a module's output depends on. Then app modules could be cached too, keyed on those files.

## 28. The app writes the TestBed setup file

*16 October 2026*

**Decision.** The plugin doesn't inject a setup file. The documented recipe is a five-line `src/test-setup.ts` that calls `initTestEnvironment` and resets TestBed in `afterEach`, listed in `test.setupFiles`.

**Why.** Apps add providers and teardown options there, and a file they own is easier to change than an option that wraps one. The `afterEach` line is the one trap: Angular registers that reset only when `afterEach` is a global, and Vitest's globals are off by default. Without it, the second test in a file fails with "the test module has already been instantiated".

**Cost.** Every app copies the same file, and an app that forgets the `afterEach` gets a confusing error. The plugin could export a ready-made setup module instead, at the cost of hiding which test environment runs.

**Revisit when** apps start copying the file with changes nobody needs, or Angular's own Vitest builder settles on a setup the plugin could reuse.
## 29. Type-check with tsgo over the app's sources and ngp's type-check blocks, in a child process

*16 October 2026*

**Decision.** The plugin type-checks with TypeScript 7's CLI (`tsgo`, installed as the `typescript7` alias of `typescript@7.0.2`), spawned as a child process with `--pretty false`. Its program is the app's own tsconfig, extended: the app's `include` stays, the type-check block of every component file is added under `files`, and `rootDirs` lists the blocks' directory next to the filesystem root. The blocks come from `HybridCompiler.getTcbForFile`, per file, cached until the analyzer marks a file stale. They're written under Vite's cache directory at each component's absolute path. A block's `import * as i0 from './app'` then resolves to the app's own `app.ts`, not to ngp's compiled output. Errors inside a block are mapped to the template with Angular's own rule (compiler-cli's `findSourceLocation`): from the node at the error, walk up to the first node followed by a `/*start,end*/` span comment, and take the template file from the block's `ngp-tcb-template-sources` comment. Errors in host bindings map to the component's `.ts`. In dev, a check runs 1 s after the server starts (changed by decision 53: now once the server is idle) and 300 ms after the last edit, never two at once, and reports to the terminal and to Vite's error overlay when the set of errors changes. `vite build` starts the check after the last module is transformed, waits for it in `generateBundle`, and fails on any error. `typeCheck: false` turns it off, and it's off by default under Vitest.

**Why.** ngp doesn't type-check, by design: its CLI writes `.ngtypecheck.ts` files for a separate TypeScript run. The bench measured that pipeline (S3/S4) on two real apps at 1.87× and 2.04× ngc's speed with `tsgo`, and at 0.90× and 0.97× with `tsc` 6, so TypeScript 7 it is. A child process keeps the Go checker off Vite's thread, so transforms and HMR never wait for it. Checking the app's original sources rather than ngp's compiled output means TypeScript errors need no source map: they're already at the right line and column, and ngp's output, which carries `// @ts-ignore` imports and template functions, never enters the program. The bench checked ngp's output because it also emitted from it. The plugin doesn't emit, Vite does. Getting blocks per file from the compiler, instead of running ngp's CLI, means an edit regenerates only the stale files' blocks. On the playground, a check after an edit takes 100–250 ms in dev, and 90–110 ms in `vite build` for the playground and the docs site. Vite's overlay closes only on the next module update or page reload, and an in-place template update is neither, so a 20-line client module opens and closes the overlay itself, and a page that loads later asks for the current errors.

**Cost.** Every component file has its block generated on the main thread at startup, one file at a time with a yield in between, so it shares the thread with the first page's transforms. That's not measured beyond the playground: 20 blocks, from 19 components, in 60 ms. Every check is a whole-program `tsgo` run, made cheaper by `--incremental` build info in the cache: the bench measured `tsgo` at 18.6 s for a full check at 5,000 components, and the incremental case hasn't been measured. The check's tsconfig lives in Vite's cache directory, and TypeScript resolves `types` entries like `vite/client` from there. With the default cache directory, `node_modules/.vite`, that finds the app's `node_modules`. With a cache directory outside the project, an app whose tsconfig lists `types` gets TS2688 on every check, and tsgo, like tsc, then skips semantic errors. A template given as an expression (`template: TEMPLATE`) gets its errors at the expression, not inside the string, as ngp's own diagnostics do. The `typescript7` dependency adds a platform binary to every install: 26 MB on macOS arm64.

**Revisit when** ngp's analyzer can feed TypeScript 7's API (`typescript/unstable`) directly, which would keep one long-lived program instead of spawning `tsgo` per check. Or when the bench measures the incremental check at 5,000 components and it's too slow for the dev loop.

## 30. Generate type-check blocks from a second compiler that keeps whitespace

*16 October 2026*

**Decision.** `NgpCompiler` holds two `HybridCompiler`s on the same analyzer. The one that compiles modules collapses whitespace, as before. The one that generates type-check blocks is created with `preserveWhitespaces: true` and without HMR, and has its own cache, dropped for the same stale files.

**Why.** ngp parses each template once, with whitespace collapsed, and takes the type-check block's spans from that parse. Every span after a collapsed run of whitespace in the same text node then points too early: in `<h1>\n  {{ titel }}</h1>`, ngp's span puts the error at column 4 and ngc at column 6, under the `t`. ngtsc parses templates a second time for type-checking, with whitespace preserved (its `diagNodes`), and ngp's own source marks the missing second parse `TODO(parity)` in `parseComponentTemplate`. With the second compiler, the plugin's positions match ngc's for every error in the type-check test, checked against ngc on the same app.

**Cost.** Each template is parsed twice, once per compiler. A component that sets `preserveWhitespaces: false` in its decorator overrides the compiler's setting, so its spans still drift. ngtsc ignores the decorator for its type-check parse. ngp doesn't let the plugin do that.

**Revisit when** ngp type-checks a whitespace-preserving parse itself. Then the second compiler goes.

## 31. Drop Angular's ignored codes in type-check blocks, instead of turning off noUnusedLocals

*16 October 2026*

**Decision.** The check keeps the app's `noUnusedLocals` and `noUnusedParameters`. In a type-check block, the plugin drops TS6133, TS6199, TS2695 and TS7006, the same four codes compiler-cli's `shouldReportDiagnostic` drops, and any error under a `/*D:ignore*/` marker.

**Why.** ngp's blocks fail `noUnusedLocals` and `noUnusedParameters`: no `_tcbN` function is ever called. The bench turned both options off for the whole program, which also hides unused locals in the app's own code, which `ng build` reports. Dropping the codes only inside blocks is what ngc does, so the app gets the same errors it would get from `ng build`.

**Cost.** None found. If ngp ever emits a block where one of those codes means a real template error, the plugin hides it, as ngc would.

## 32. Send stylesheets through Vite's CSS pipeline, as links in dev and inlined in builds

*16 October 2026*

**Decision.** ngp always compiles with `externalRuntimeStyles`, so `styleUrl` files leave the component as paths in `ɵɵExternalStylesFeature([...])`. A normal-order plugin rewrites that call after Vite's oxc transform ([styles.ts](../packages/vite-plugin-ngp/src/styles.ts)). In the dev server, client and server alike, the paths become URLs, Angular's runtime adds a `<link>` per stylesheet with `?ngcomp=<id>&e=<encapsulation>`, and the plugin scopes the compiled CSS to that id. In `vite build`, client and server alike, and under Vitest, the call becomes a feature that prepends `?inline` imports to the component's `styles`, scoped at build time for emulated encapsulation. Scoping is `encapsulateStyle` from `@angular/compiler`, run in a transform between `vite:css` and `vite:css-post`.

**Why.** Without `externalRuntimeStyles`, ngp reads `styleUrl` files from disk and inlines them raw, so a `.scss` file arrives in the browser as uncompiled SCSS, and ngp has no hook to change that. Handing the files to Vite gets every preprocessor, PostCSS and `url()` rewriting for free, and `vite:css` hands the plugin plain CSS. So the plugin never touches Vite's output: no regex over `__vite__css`, the pattern that kept breaking in Analog (analogjs/analog#2492, #2049).

Links in dev are what make in-place style edits possible: a `<link>` can be reloaded alone. In builds they'd cost a request per component and a flash of unstyled content, which is why the CLI inlines in production too. The server follows the browser: in dev it renders `<link>`s, so the browser adopts them on hydration and style edits reach them. Rendering inline `<style>`s on the dev server instead would leave the server's stale rules on the page after the first edit.

Build imports are scoped with the id `__ngpcomp__`, and the feature swaps it for `%COMP%` at runtime. Scoping with `%COMP%` directly failed the playground build: Vite's minifier, lightningcss, rejects `%` in an attribute selector. Which classes are emulated comes from ngp's metadata.

**Cost.** Two paths: a bug in one won't show in the other. The tests run the playground's SCSS component through a dev server and a build to cover both. The rewrite finds `ɵɵExternalStylesFeature([...])` by pattern in ngp's output, after oxc. That output is pinned with Angular, and the tests break if its shape changes, but it is still a pattern over generated code. Inline `styles` stay with ngp and can't be preprocessed. Scoping drops CSS source map adjustments. A stylesheet whose text contains `__ngpcomp__` would have it replaced.

**Revisit when** ngp grows a resource hook (then inline styles could be preprocessed too), or emits something less fragile to find than a printed call.

## 33. Serve dev stylesheets under flat names

*16 October 2026*

**Decision.** In the dev server, a component stylesheet's URL is a name with no directory, `<basename>.ngp-<first 8 hex of sha256(path)>.<ext>`, relative to the page. `resolveId`, ordered before Vite's resolver, maps any request whose last path segment is such a name back to the file, whatever directory it arrives under.

**Why.** Angular's `SharedStylesHost` adopts server-rendered `<link>`s keyed by `href.slice(href.lastIndexOf('/') + 1)`, and looks them up by the URL the runtime would add. With root-relative URLs like `/src/app/card.css`, the two never matched. Every link was added a second time on hydration, and Angular copied the adopted ones into `ShadowDom` roots under the shortened key, as relative URLs that loaded `/card.css`, a file that doesn't exist. The Angular CLI uses flat hashed names for this reason. Relative names resolve against the page, so on `/router/signals` the browser asks for `/router/card.ngp-de07cd19.css`, and resolving by name alone handles that without a `<base href>`.

**Cost.** The mapping from name to file lives in memory and is filled as components compile. A request for a stylesheet before its component has compiled in this server process falls through to Vite and fails. That doesn't happen on a normal page load, because the component's module always loads first. Two files with the same basename get different hashes, so names don't collide, but devtools shows `card.ngp-de07cd19.css` rather than the path.

## 34. Update stylesheets with our own HMR event

*16 October 2026*

**Decision.** On an edit to a component stylesheet, or to a file only component stylesheets import, the plugin invalidates those modules, sends `angular:stylesheet-update` with their names, and returns no modules for them. A listener sets the `href` of every matching `<link>`, in the document and in shadow roots, keeping the query and adding a fresh `t=`. Components with external stylesheets import the listener in the dev server's browser environment.

**Why.** Vite's client handles `css-update` with `cleanUrl(path)`: it drops the query, so the new link loses `ngcomp` and arrives unscoped, and it updates only the first `<link>` that matches. One stylesheet used by two components, or copied into a shadow root, has several. The CLI works around the same client by reloading the page for `ShadowDom` components; this listener covers them. Changing `href` on the same element, rather than adding a new one, keeps `SharedStylesHost` pointing at the element it will remove when the component goes away.

The listener first came from `transformIndexHtml`. An app that serves its page without that hook would have lost style edits silently: no update and no reload. Importing it from the components ties it to the code that needs it.

**Cost.** A few lines of client code and an event of our own to keep working. Setting `href` in place may flash the old rules away before the new ones load. That wasn't visible in the playground, but it wasn't measured either. Vite's `css-update` would avoid that by adding the new link before removing the old one.

## 35. Hold a template update only while the page's class is out of date

*16 October 2026. Supersedes 22. Narrowed by 48. Amended by 49.*

**Decision.** A template update still waits 50 ms. Then the plugin holds it back only if the component's `.ts` file changed after the browser last loaded it, and that change wasn't applied in place. The page reloads for that change and loads the template with it. If the `.ts` file on disk differs from every version the plugin has seen, the plugin waits up to a second for the watcher to report it, and reloads if the report never comes. A watcher report whose content the plugin has already seen isn't a change: it records nothing, and sends no update.

**Why.** Decision 22 assumed that the watcher reports one save's files within 50 ms of each other, and each write once. FSEvents on macOS breaks both. The dev-server HMR test failed about once in 20 runs of the suite. In one failure, a single template write was reported twice and sent two updates. In another, `app.ts` was reported 1 ms after the save, and `app.html`, with a second report of `app.ts`, 100 ms later. The repeat counted as an in-place edit, so the template update went out to a page the first report was reloading. A wider window would slow every template edit and still be a guess. Comparing with what the page loaded doesn't depend on timing. The browser's transform of a `.ts` module marks when the page got a class, and the watcher marks when the class changed.

It also fixes the opposite mistake. Under 22, a template reported more than 50 ms after its class was sent as an update, even while the page was still reloading for the class. Now the template waits until the page has loaded the new class, and then goes out against it.

**Cost.** More state to keep right: a load and a change per `.ts` file, ordered by one counter. Each `.ts` change and each browser transform reads the file once more, and each template update reads its component's file. A class change the watcher never reports holds the template for a second, then reloads. The load counts when Vite transforms the module, not when the page runs it, so a page that's slow to run a reloaded module could still receive an update meant for after it. That wasn't seen, and the update module the page imports at startup would correct it.

**Revisit when** chokidar or Vite report each save once and in one batch. Then the repeat handling can go, though the load comparison is still the simpler rule.

## 36. Take `ng build`'s missing options as plugin options, not from angular.json

*16 October 2026*

**Decision.** The plugin takes `fileReplacements`, `budgets` and `polyfills` as options, with the names and shapes angular.json uses for `@angular/build:application`, so they can be copied over unchanged. It never reads angular.json. Every other build option maps to Vite's own config or isn't supported. The site's migration page lists all of them, with the reason for each.

**Why.** These three have no Vite equivalent. `fileReplacements` also has to reach ngp's analyzer, which only the plugin can do. Everything else a typical app sets in angular.json already has a Vite option: `define`, `base` for `baseHref` and `deployUrl`, `public/` for the default `assets`, `build.sourcemap`, `build.outDir`, `build.license` for `extractLicenses`. Reading angular.json would mean interpreting its configurations, its builder-specific defaults and its workspace layout, for a file that a finished migration deletes. Vite already has `mode` for what angular.json calls configurations.

**Cost.** During a migration that keeps `ng build` working, the three options live in two places. Options that apps do use and Vite can't do are left out: critical CSS inlining, subresource integrity, the service worker manifest, prerendering, `autoCsp` and i18n.

**Revisit when** apps want to keep `ng build` and the plugin side by side for long. A helper that turns an angular.json configuration into plugin options would fit then.

## 37. File replacements swap content under the replaced file's id, in Vite and in the analyzer

*16 October 2026*

**Decision.** A replaced file keeps its own module id. The plugin's `load` hook returns the replacement's content for it, and `NgpCompiler.create` sends the same content to the analyzer under the replaced path before anything compiles. Watcher edits to the replacement are sent as edits to the replaced file, edits to the replaced file are ignored, and a transform of the replaced file never updates the analyzer.

**Why.** ngp's analyzer resolves imports on disk and has no hook to redirect them. If only Vite resolved `environment.ts` to `environment.prod.ts`, the analyzer would still read `environment.ts`, and any decorator that reads a value from it would compile against the wrong file. The test fixture's banner does exactly that. Swapping content under one id keeps a single identity for the file in both systems. Transforms are kept out because Vite can read a module just before an edit and transform it after: in testing, that sent the old content to the analyzer and undid the edit in 2 of 13 runs.

**Cost.** The replacement's relative imports resolve from the replaced file's directory, not from its own as under the CLI. Source maps and errors name the replaced file. Editing the replacement reloads the page; it never updates a component in place.

**Revisit when** ngp's analyzer accepts a module resolution hook. Then the plugin can resolve to the replacement in both places, as the CLI does.

## 38. Import polyfills first in each entry module

*16 October 2026*

**Decision.** The plugin prepends one import per polyfill to every module in `entries`, with a source map. In browser environments that's the list as given. In server environments `zone.js` becomes `zone.js/node`, `@angular/localize` polyfills become `@angular/localize/init`, and the rest are dropped, which is what the CLI gives its server bundle. A polyfill with a file extension that exists under Vite's root is imported as that file.

**Why.** zone.js must run before `@angular/core` is evaluated. An entry's first import is evaluated first, in dev, in Rolldown's bundle and in Node, so one mechanism covers all three. The CLI builds polyfills as a separate bundle that index.html loads first, but a server entry has no index.html, and a second `<script>` would have needed its own handling in dev, in the build and in the SSR middleware.

**Cost.** Polyfills sit in the entry chunk instead of a separate `polyfills` file, so a `bundle` budget named `polyfills` measures nothing. Under Vitest, `entries` is empty and no polyfills are added; a zone.js test setup imports `zone.js` and `zone.js/testing` itself.

## 39. Rewrite async/await with esbuild for zone.js apps

*16 October 2026*

**Decision.** When `polyfills` includes `zone.js`, or any file (which might import it), the plugin rewrites `async` functions into generators with esbuild's `transform` and `supported: {'async-await': false, 'optional-catch-binding': false}`, exactly the CLI's setting. Builds rewrite each output chunk in `renderChunk`. The dev server rewrites each served module that contains `async`, pre-bundled dependencies included. esbuild 0.28.2 is a dependency, the version `@angular/build` pins.

**Why.** zone.js patches `Promise`, but a native `await` doesn't go through it, so code after an `await` runs outside Angular's zone and never triggers change detection. In the test fixture, that code ran in `<root>` without the rewrite and in `angular` with it, and in a browser the page stayed on "loading". Rolldown and oxc can lower async functions only by lowering a whole ES version: at `es2016` they also rewrite optional chaining, object spread and class fields, in every module. That's what the CLI's dev server does for pre-bundled dependencies, because Rolldown offers nothing narrower, and it's what this plugin avoids.

**Cost.** A second parser in the build, and one more pass over every chunk with `async` in it: 452 bytes and about 60 ms per build on the 311 kB fixture, which isn't measured on a large app. Native async stack traces are gone in zone.js apps, as they are under the CLI.

**Revisit when** Rolldown or oxc can lower async functions alone.

## 40. Check budgets on Rolldown's output, and measure component stylesheets the CLI's way

*16 October 2026*

**Decision.** Budgets are checked in `generateBundle` of the browser build, with the CLI's calculator and messages ported to [budgets.ts](../packages/vite-plugin-ngp/src/budgets.ts). Only `.js` and `.css` files count, as in the CLI. Initial is every entry chunk, the chunks they import statically, and the CSS those chunks import. A chunk answers to its Rolldown name and to the file name of any app entry it contains, so `main` names the chunk with `src/main.ts`. `anyComponentStyle` takes the list of each component's stylesheets from ngp's metadata. A `styleUrl` file is measured as the CLI measures it: compiled, then minified with esbuild, before view encapsulation adds its selectors. The plugin reads it right after `vite:css` compiles it and before the styles plugin scopes it ([decision 32](decisions.md)). An inline style is measured as written. Warnings are logged; errors are logged and then fail the build.

**Why.** Rolldown's bundle already knows each chunk's size, imports and CSS, which is everything the CLI's stats object held. Component stylesheets end up as strings inside the JavaScript, so no CSS asset exists to measure. Measuring after scoping overstated them: every selector gains `[_ngcontent-__ngpcomp__]`, and the playground's `app.css` came out at 4.44 kB, more than the 4.28 kB file, against 3.34 kB the CLI's way. Same method, same numbers, so a budget copied from angular.json means the same thing. The message text matches the CLI's too, so CI scripts that grep for it keep working.

**Cost.** Inline `styles` are measured as written, because ngp compiles and ships them that way, so they come out larger than under `ng build`, which minifies them. The budgets plugin depends on running between `vite:css` and the styles plugin: if either moves, the measure silently changes. Lazy chunks are named after their file, which may not match the names `ng build` gave them.

**Revisit when** ngp can minify inline styles, or hands them to Vite.
## 41. Serve one locale in dev, translated at runtime

*16 October 2026*

**Decision.** With `i18n`, the dev server serves `devLocale` only. A virtual module that every entry imports first loads `@angular/localize/init`, the locale's global data, and its translations through `loadTranslations`. Translation files are parsed on the server with @angular/localize's parsers, and editing one reloads the page.

**Why.** It keeps the dev server's per-module transform untouched: a module compiles to the same code whatever the locale, and template HMR update modules call `$localize` like any other. `ng serve` inlines translations at build time instead, which its whole-program build allows and a per-module server doesn't need.

**Cost.** Dev runs `$localize` at runtime and production doesn't, so a message that breaks only when inlined shows up only in `vite build`. Switching locale means restarting the dev server.

## 42. Extract messages from an in-memory build

*16 October 2026*

**Decision.** `ngp-extract-i18n` builds the browser bundle with `write: false`, no minification and source maps, skips translation, and runs @angular/localize's `MessageExtractor` and serializers over the chunks, with a small in-memory file system. It writes XLIFF 1.2 by default, like `ng extract-i18n`.

**Why.** It's what the CLI's application builder does, and it extracts from what ngp actually emitted, so the ids match what the build will look up, including messages in libraries. Extracting from source files instead would need ngp's output per file, which is TypeScript the extractor can't parse.

**Cost.** Extraction is a full build: under 2 seconds on the playground, longer on a large app. Messages from external templates point at the component's `.ts` file and decorator line, not the `.html` line, because ngp's source map doesn't cover generated template code. Only the browser bundle is read, so a message used only in server code is missed.

## 43. Build once, then write every file once per locale

*16 October 2026*

**Decision.** `vite build` builds and minifies each environment once. A `generateBundle` hook that runs last removes every file from the bundle and emits it again below `<outDir>/<subPath>/` for each locale, translated, with its source map composed and the public directory copied in.

**Why.** The first version set one Rolldown output per locale and translated in `renderChunk`, before minification. Rolldown starts the build again for every output, so every module was transformed once per locale: `app.ts` compiled four times for two locales and two environments. Build time would grow with the number of locales times the app's size. Translating after the build is what the CLI does, and costs a parse and a string edit per chunk. Measured on the playground, average of three runs: 1.8 s without i18n, 2.1 s with two locales.

**Cost.** Translation edits minified code, so it depends on the minifier keeping `$localize` tagged templates and the prelude recognizable ([design](design.md#where-its-weak)). A chunk has the same file name in every locale, as with the CLI. Its hash includes every translation file (`augmentChunkHash`), so editing a translation renames every chunk, in every locale, even where nothing changed. Every locale gets a full copy of the assets and the public directory.

**Revisit when** a project has enough locales that copying assets per locale matters.

## 44. Translate with Vite's parser and @angular/localize's translate, not its Babel plugins

*16 October 2026*

**Decision.** Each chunk is parsed with Vite's `parseAstAsync`, and the `$localize` tagged templates, `$localize.locale` reads and the prelude's placeholder are found once per chunk and reused for every locale. Each message goes through `translate()` from `@angular/localize/tools`, and MagicString writes the result.

**Why.** The Babel plugins `makeEs2015TranslatePlugin` and `makeLocalePlugin` are the public way, and they were the first version. Babel spent 150–400 ms per locale on each 600–800 kB vendor chunk whose only `$localize` use is Angular reading `$localize.locale`. With the per-output design of the first version, the playground's build went from 3.3 s with Babel to 2.2 s with the native parser, against 1.4 s without i18n before the build optimizer landed. `translate()` is the function those plugins call, so translations, missing-translation diagnostics and placeholder reordering behave the same. The CLI's own inliner moved from Babel to oxc for the same reason.

**Cost.** The pass finds `$localize` by name and doesn't check whether it's shadowed, as the CLI's inliner doesn't either. A `$localize.locale` read with a guard the minifier rewrote (`typeof $localize<"u"`) keeps its guard, which is harmless because the prelude defines `$localize`.

## 45. Serve each locale from `<base><subPath>/` with relative URLs

*16 October 2026*

**Decision.** i18n builds and `vite preview` use `base: './'`. Each locale's `index.html` gets `<base href="<base><subPath>/">`, where `<base>` is the user's `base`. `vite preview` gets a middleware that serves each locale's `index.html` for its pages and redirects `/` by `Accept-Language`.

**Why.** One build serves every locale only if its URLs don't name the locale. Relative URLs resolved against `<base href>` do that, and Angular's router reads the same element. The CLI sets the same `<base href>` per locale.

**Cost.** No per-locale `baseHref` override, which the CLI has. A `base` that is a full URL, such as a CDN, is untested.

## 46. A transform leaves the analyzer alone when Vite read its code before the watcher's last edit

*17 October 2026*

**Decision.** The plugin's `load` hook records when Vite read each `.ts` module, and `NgpCompiler` records when the watcher last sent each file, or reported it deleted. A transform whose module was read before that, or whose read time is unknown, sends its code to the analyzer only if the code is what's on disk now. Replaced files keep [decision 37](#37-file-replacements-swap-content-under-the-replaced-files-id-in-vite-and-in-the-analyzer)'s rule: their transforms never update the analyzer, because their code comes from another file and disk can't vouch for it.

**Why.** Vite can read a module, see the file change, and transform the module afterwards with the old code. Sending that code reverted the analyzer: components compiled before the file's next transform used the old file, and nothing invalidated them later. A test that holds a transform between Vite's read and ngp reproduces it for an ordinary file in 3 of 3 runs without the guard, and passes 20 of 20 with it. Skipping is safe because the edit invalidated the module while the transform ran, so Vite discards the result and transforms the module again. The disk check covers the reverse: a file written again after the watcher read it, whose newer code mustn't be skipped. Comparing content alone, without the read time, would also skip code a plugin before ngp changed on purpose, on every transform after an edit.

**Cost.** A `load` hook call for every app `.ts` module, and a disk read in a transform that races an edit. When another plugin's `load` supplies a module, its read time is unknown, and after a watcher edit its transforms reach the analyzer only if their code matches disk.

**Revisit when** Vite passes `transform` the time or version of the code it read.
## 47. Public repo, with the bench repo still private

*17 October 2026*

**Decision.** `push-based/vite-angular` is public, and the docs site, the README and Getting started say so: anyone can clone it and build ngp. The bench repo stays private, and the few links into it are labeled. Supersedes [decision 10](decisions.md).

**Why.** The repo depends on nothing private. ngp is built from Angular's public source, and the bench results the Performance page cites are in this repo's `bench/results/`. A public repo is the only way someone outside PushBased can try per-module Angular compilation before Angular publishes ngp, and the docs site already was public.

**Cost.** Everything in the repo is published the moment it's pushed, docs and decisions included, so the no-machine-paths rule and the measured-numbers-only rule now apply to every file, not just the site.

## 48. Count a template update's 50 ms wait from the template's write

*17 October 2026. Narrows 35.*

**Decision.** A template update waits until 50 ms after the template file's modification time, not 50 ms after the watcher reports the change. When the report comes later than that, the update goes out at once. The rest of [decision 35](#35-hold-a-template-update-only-while-the-pages-class-is-out-of-date) stands: the class check, the wait for a class change the watcher hasn't reported, and ignoring repeated reports.

**Why.** Timing each step of the update path (`DEBUG=vite-plugin-ngp` now logs them) on the bench's 1,000-component app showed where a template edit's time went. The watcher took 4–112 ms to report the write. The wait took 50 ms. Everything else took about 5 ms: reading the file, the analyzer update, ngp's update module (3.3 ms), oxc stripping its types and sending the event. The browser asked for the update module under 1 ms after the event. So the wait was nearly all of the gap to `@oxc-angular/vite`. It exists for one save that writes the template and then the class a few milliseconds later. That's a question about when the files were written, so it counts from the write. On macOS the watcher usually reports a write about 110 ms after it, and by then the window is long over. With 20 edits each, in one run per version, the median template edit at 1,000 components went from 169 ms to 120 ms, against 117 ms for `@oxc-angular/vite` in the same run. The fastest went from 69 ms to 58 ms, not further: when the watcher reports within about 10 ms, about 40 ms of the window is still left.

Dropping the wait was the alternative. On macOS the watcher's delay would cover most saves anyway. Nobody has measured Linux, but a watcher there that reports within a millisecond would send the template update before a class written right after it, and the page would get a failed update and an error before reloading.

**Cost.** The modification time has to be the write time. A tool that keeps a file's old time (`cp -p`, `rsync -t`, unpacking an archive) gets no wait, and so does a file system that stores whole seconds (HFS+, FAT), where most writes look old. Then a class written right after its template gets decision 22's failed update and a reload. A file server whose clock is ahead can only make the plugin wait the full 50 ms, never longer. The 40 ms left on a fast report is still a guess at how far apart an editor writes one save's files, and it's why the fastest edit is 58 ms against oxc's 16.

**Revisit when** someone measures how far apart editors and `git checkout` write one save's files. If it's well under 50 ms, the window can shrink, and the fastest edit with it.

## 49. Read a reported `.ts` file as Vite does, waiting out an empty read

*17 October 2026. Amends 35.*

**Decision.** The three places that read a `.ts` file to decide about a template update (`watchChange` recording a reported change, the class check in `pageClass`, and the transform recording what the browser loaded) use one helper, `readWritten`. If the file reads empty, it waits up to 100 ms for the file's modification time to change, then reads again. That's Vite's own `readModifiedFile`. `watchChange` is async now. Vite awaits it once per environment, all at the same time. The reports for one file are recorded one after another: the environments' calls for one save read the same content, and every call after the first is a repeat. A second save that's reported while the first is still being read gets its own read. Sharing one read per file would have merged it into the first, and left the second save unrecorded.

**Why.** CI failed twice in a row on the dev-server HMR test, on GitHub's runner only. Neither failure reproduced in 45 instrumented CI runs, nor in about 100 local runs on macOS and Linux, loaded or starved. Writing a file truncates it and then writes it, as two separate steps on Node's thread pool, and a busy pool can leave a gap between them. `watchChange` read the file synchronously when the watcher reported it. Caught in the gap, it recorded the class as empty. That never matched disk, so the next template edit waited the full second for a report that never came, and reloaded the page a second time. The second reload landed in the next test, which is the shape of the second failure. A test now reports a change between the truncate and the write. The old code sends two reloads there, and this one sends one. The first failure was the test's own fault: its two writes landed more than 50 ms apart, which the plugin rightly treats as two edits. The test now holds the watcher's reports until both files are written.

**Cost.** An empty `.ts` file now takes up to 100 ms longer to reach the plugin, because it can't be told apart from one caught mid-write. Vite pays the same price. The fix covers only the cause the evidence fits: neither failure was caught with logging on, so a third cause can't be ruled out.

**Revisit when** CI fails on `hmr.test.mjs` again. The debug workflow that looped it with event logging is in this entry's commit message.

## 50. Benchmark two real apps against their own CLI, on GitHub's runners

*17 October 2026*

**Decision.** `bench/` runs two open-source Angular apps, Super Productivity (Angular CLI, 252 components) and Ghostfolio (Nx, 157 components), under the plugin and under the CLI each is built with, and records memory next to time: the peak resident set of a tool's whole process tree, and what a dev server holds once the page has rendered. The apps are pinned to a commit, installed by a script, and given a `vite.config.ngp.mjs` written the way the docs tell a user to move off `ng build`. Where the plugin has no option for something the app's CLI does, the bench adds a small Vite plugin next to it in that config, never in the plugin: typia's TypeScript transformer over a TypeScript program, Angular's `ngsw-config` after the build. Where an app's sources don't compile under a per-file compiler, a patch with a header fixes them, and both tools compile the patched sources. The published numbers come from a GitHub Actions workflow, `bench-real`, one app per runner, with the result files committed to `bench/results/`. The Benchmarks page documents the runs.

**Why.** The Performance page measures generated apps, and its weakest point was that no real app with third-party libraries, no Linux machine and no memory had been measured. A real app is also the only way to find what a migration costs: Super Productivity needed its `isolatedModules` violations fixed, a stub for an uninstalled dependency, its typia transformer, esbuild's CSS minifier and decorator metadata off; Ghostfolio needed its path aliases, 13 locales, a stub API and a template type error ngp reports and ngc doesn't. Each of those is now written down with the fix a Vite user would apply. Running on CI makes the numbers reproducible by anyone with the repo, on a machine nobody is also working on, which the laptop numbers never were.

Putting the bench's helpers into the plugin was the alternative. A `serviceWorker` option and a typia hook may be worth having, but they'd be decided on one app each, and the bench can't wait for them. Keeping them in the app's config also keeps the comparison honest: the plugin's numbers include what a user has to add to get the same job done.

**Cost.** Two patches to apps we don't own, which have to be re-made when the pin moves, and a stub API whose saved response ages. The typia program adds seconds to the plugin's start and build on Super Productivity that are typia's, not ngp's, and the tables can't separate them. GitHub's runners differ from run to run, so a number is comparable within its run, not across runs. A full run costs about an hour of CI per app, so it's run by hand, not on every push.

**Revisit when** the plugin grows a service-worker option, when a third real app with a different shape (a library-heavy enterprise app, or a Nx workspace with many libs) is pinned, or when the generated apps can run on CI without the disk noise the private bench repo measured.


## 51. Draw the benchmark figures as inline SVG from the site's tokens

*17 October 2026*

**Decision.** `bench/charts.mjs` draws the figures on the Performance and Benchmarks pages from the same result files `report.mjs` turns into tables, as SVG files in `site/content/charts/`. A page embeds one with markdown's image syntax, and the site's markdown pipeline inlines a local `.svg` instead of linking it, inside a `<figure>` with the alt text as its caption. Every figure is one form: horizontal bars on one shared scale, one panel per app, the value at each bar's tip. The plugin's bar is the brand violet (`--color-brand`) and every other tool's is `--color-neutral-400`; the row label names the tool. The tables stay on the pages, under the figures.

**Why.** The pages had a dozen tables of medians, and the point of most of them is one shape: the CLI's time grows with the app and the plugin's doesn't. A bar per tool per app shows that at a glance, and a shared scale across the panels is what makes the growth visible; per-panel scales would hide it. Inlining the SVG is what lets it use the site's tokens: an `<img>` can't read the page's CSS variables, so it would need its own colors and its own dark theme, and the site has a theme toggle as well as the system setting. Inlined, `fill: var(--color-brand)` follows both for free. Emphasis rather than a color per tool: with the tool named at the left of each bar, color only has to answer "which one is the plugin", and a four-hue palette from the tokens failed the color-vision checks for charts where any two bars can sit next to each other (the violet and the blue collapse under deuteranopia). The violet-and-gray pair passes them in both themes; the gray is below the chroma floor by design, it's the de-emphasis color. The fastest edit is a ring on the bar because the pages explain that macOS's watcher makes every Vite tool's edits bimodal, and the median alone hides that.

Generating the figures at the site's build time, from the result files, was the alternative. It would keep `site/content/charts/` out of the repo, but it would make the site's build read `bench/results/`, and a reader of the markdown on GitHub would see no figure at all. Committed SVGs render there too.

**Cost.** A figure is a fixed 640 pixels wide, so on a phone it scrolls sideways, like the wide tables already do, rather than reflowing. Every rerun of the benchmark is now two commands, `report.mjs` and `charts.mjs`, and a figure can go stale against its table if someone edits the markdown table by hand. The check in `pnpm docs:check` only knows whether the file a page embeds exists.

**Revisit when** a figure needs a form the renderer doesn't have (a distribution of the edits, say), or when the pages get a third tool on the real apps and the two-series legend stops being enough.

## 52. Search the docs site with Pagefind, loaded when search opens

*17 October 2026*

**Decision.** The docs site has ⌘K search. `site/scripts/search-index.mjs` runs Pagefind (pinned at 1.5.2) over the prerendered pages after `prerender.mjs`, as part of `pnpm --filter site build`, and writes the index to `dist/client/pagefind`. Only the article of each docs page is indexed (`data-pagefind-body`), so the home page, the 404 page and the site chrome stay out of the results. The search button and the shortcut live in the app shell; the dialog is its own component in `src/app/search/`, which the shell imports on the first open (or when the pointer or focus reaches the button), and the dialog imports `pagefind/pagefind.js` from the site's base path when it opens. The dialog is the site's own: a native modal `<dialog>` on the site's tokens, a combobox over a list of pages and their best-matching sections, with arrow keys, Enter and Esc. A result goes through the router; a modified click opens a new tab.

**Why.** Every reference docs site has search, and the Features section grows with every feature session, so the sidebar alone stops being enough. Pagefind is what Starlight uses: a static index that GitHub Pages can host, built from the HTML the site already renders, with no service to run. Loading it on demand keeps first paint where it was: the first page loads the same three files as before, and the dialog's 2.8 kB, Pagefind's script and worker (25 kB), its WebAssembly (73 kB) and the index (64 kB for 14 pages; all sizes compressed) arrive only with search. A native modal dialog makes the page behind it inert and closes on Esc, so the focus trap comes from the browser rather than from code. Pagefind's own UI was the alternative; it brings its own look, which would have to be overridden piece by piece to match the tokens and both themes, and it ships a further 400 kB of UI files the build now deletes.

**Cost.** Search only works on the built site: `pnpm site:dev` has no index, and the dialog says so. The first open waits for the dialog's chunk, so keys typed in the first moment after ⌘K, before the field exists, are lost. The index is per build and in English only. Ranking is Pagefind's default: a word in a page's code or tables counts like one in its prose, so for `typeCheck` the Changelog and Performance pages rank above Configuration.

**Revisit when** the index grows enough that its first load is noticeable on a phone, or when the site gets a second language.

## 53. Start the first type-check once the dev server is idle, not 1 s after it starts

*17 October 2026*

**Decision.** In the dev server, the first type-check starts once the server has been idle for 500 ms: no HTTP request being answered, counted by a middleware installed ahead of Vite's own, and no module in the plugin's transform hook. If the server never goes idle for that long, the check starts 60 s after the server began listening. Checks after edits keep their 300 ms debounce, two checks never run at once, and `vite build` is unchanged. Decision 29's fixed 1 s delay is superseded.

**Why.** Generating a type-check block is synchronous ngp work on Vite's thread, and the first check generates one for every component file in the program. On the playground that's 20 blocks in 60 ms, which the 1 s delay hid. On Super Productivity, 252 components and about 1,300 modules on the first page, a CPU profile on 17 October 2026 put `getTcbForFile` at 671 ms inside the 7.6 s to first paint, with the thread saturated the whole time: every module the page was waiting for, including the global Sass stylesheet, queued behind the blocks. The 1 s delay only decides when that contention starts. Waiting for the server to go idle moves the whole of it after the page. Measured on the laptop (M2 Max, load average 3 to 7 from other sessions), warm restarts of Super Productivity through the bench's Chrome harness, one warm-up and 5 measured, medians: first contentful paint 6.72 s before and 6.00 s after, the page rendered at 7.46 s before and 6.58 s after. The 0.72 s gained matches the profile's 671 ms. On the generated 5,000-component app, measured on 18 October 2026 with `bench/run.mjs --apps standalone-5000-s1 --metrics dev-cold,dev-warm --max-load 4`, the plugin at `c335ee1^` and at `c335ee1` built as two sibling packages and run as two tools in the same rounds, one warm-up and 5 measured each, every sample at a 1-minute load average between 3.7 and 4.0 (`bench/results/2026-10-18-first-check-idle-ab.json`): cold start to first paint 1.84 s before and 1.70 s after, with every sample of the old plugin (1.82 to 1.85 s) slower than every sample of the new (1.70 to 1.74 s); a restart 635 ms before and 642 ms after, inside the 15 ms spread of either. A cold start takes the page past the old 1 s delay, so the check used to overlap its last 0.8 s, and the 140 ms it took match the 150 ms a cold start saved with `typeCheck: false` on 16 October (`bench/results/2026-10-16-typecheck-cost.json`). A restart paints at about 640 ms, before the old delay ever fired, so there was nothing for it to gain. The plugin at main's `3de71a5`, as a third tool in the same run: 1.72 s and 638 ms. Other options: generating the blocks in a worker thread would keep the first error report where it was, at the cost of a second analyzer's memory and a second tsconfig read, and generating each block as its file is compiled would still run on the thread during the page. Idle is a request count rather than only the plugin's own transforms because a single long transform, like a 4 s Sass compile that is mostly waiting on the Sass process, has no plugin transform in flight and would look idle.

**Cost.** The first error report comes later: on Super Productivity, 8.9 s after the start instead of 7.1 s, because the check used to start at 1 s and run `tsgo` alongside the page. The idle wait is 500 ms of pure delay on a small app where the page loads in under a second. An app that keeps the dev server busy without a pause, such as one polling a file the server serves every few hundred milliseconds, waits the full 60 s for its first check; its edits are checked as before. The type-error time after an edit was measured on the generated 1,000-component app with `bench/run.mjs --metrics typecheck` before and after, 2 warm-ups and 10 measured edits each, on the same laptop the same evening: the error reached the terminal in a median of 660 ms before and 650 ms after, and the fix cleared it in 612 ms before and 659 ms after, with every sample between 554 and 691 ms. The Performance page's 639 ms for this app was measured earlier in the day on a quieter machine; the check after an edit doesn't go through the idle wait, so no change was expected.

**Revisit when** ngp can generate blocks off the main thread, or when the first page's compile stops being thread-bound. Then the check can start at once again.

## 54. Pre-bundle the server's Angular libraries once, without source maps

*17 October 2026. Amends 18.*

**Decision.** In the dev server with `ssr`, the `ssr` environment pre-bundles its dependencies the way the client does: `optimizeDeps` with discovery on, scanning the server entry, with the linker as a Rolldown plugin. Only the libraries `resolve.noExternal` names go into the bundle; a Rolldown plugin marks every other bare import from inside them external, so Node loads one copy of rxjs for the bundle and for the app, as it did before. The server's compile-time globals (`ngServerMode`, `ngJitMode`, `ngHmrMode`, `ngI18nClosureMode`) are baked into the bundle, and the bundle's source maps are deleted once Rolldown has written them. With `i18n`, the prelude's imports go into the server bundle's `include` too. The cache is `node_modules/.vite/deps_ssr`, and Vite's own rules decide when it's rebuilt: the lockfile, the resolve options or the plugin list changed, or `--force`. Builds and Vitest are untouched: both still rely on `noExternal` and the transform-time linker.

**Why.** The Performance page measures the dev server without SSR, and the playground with `ssr: true`, which is what `pnpm dev` runs, took almost three times as long to show its first page. A CPU profile of a warm restart on 17 October found that the time was Vite's `ssr` environment loading Angular's packages from `fesm2022` on every start: the Babel linker about 385 ms, Vite's module-runner transform and its source-map combining about 320 ms, import analysis about 120 ms. The client never pays that twice, because its pre-bundled dependencies sit in `node_modules/.vite/deps`. Vite turns the optimizer off for server environments by default, since Node can load `node_modules` itself, but Angular libraries can't be left to Node ([decisions 18 and 20](#18-bundle-angular-in-server-environments)), so they went through the whole pipeline on every start with nothing cached.

Measured on the playground, warm restarts, median of 6, first `GET /` with `accept: text/html` after the server listens, M2 Max, Node 26.12, Vite 8.3.4, before decision 53 moved the first type-check off the first page, so the check ran alongside the page in every row (`measure.mjs` in the session's scratchpad, not in the repo):

| | listening | first page | start to page |
|---|---|---|---|
| before | 234 ms | 1,307 ms | 1,541 ms |
| with the `deps_ssr` cache | 243 ms | 952 ms | 1,198 ms |
| plus baked globals and no maps | 240 ms | 740 ms | 977 ms |

The cache alone removed the linker. The next 210 ms were Vite reading each chunk's hidden source map (1.6 MB for core), parsing it and combining it with the module-runner transform's map, plus `vite:define` running oxc over every chunk to replace the globals. Baking the globals leaves `vite:define` nothing to match, and without a `.map` file next to the chunk Vite has nothing to combine. What's left of the 740 ms, from the profile after the change: Vite's module-runner transform of the 1.5 MB pre-bundle (130 ms, 100 of it parsing), Node linking the modules it loads itself, ngp compiling the page's own modules (about 75 ms) and evaluating them (about 65 ms). The first start after an install or a config change pre-bundles the server's libraries, about 0.35 s on the playground, and `DEBUG=vite:deps` shows it.

A disk cache of the linker's output, keyed by file content and Angular version, was the alternative. It would have removed the linker's 385 ms in both environments and under Vitest, but left Vite's transform and source-map work in place, and added a cache the plugin would own, invalidate and document. Vite already has one.

**Cost.** A server stack trace through Angular's code points into `node_modules/.vite/deps_ssr/core-<hash>.js`, readable and unminified, rather than into `fesm2022/core.mjs`. The app's own modules keep their maps. A library first imported while the server runs is bundled then, and Vite reloads the server program, about a second on the playground; the client does the same. The Rolldown plugin that externalizes decides like Vite's `shouldExternalize`, by whether a bare import resolves into `node_modules`, but it's a copy of that rule, not a call to it. A server environment other than `ssr` gets `noExternal` and no pre-bundling, as before.

**Revisit when** Vite lets a server environment share the client's optimizer rules, or offers a way to turn off the pre-bundle's source maps instead of deleting them, or when Angular's oxc-based linker becomes usable and the linker stops being worth caching.

## 55. Compile apps, not libraries

*17 October 2026*

**Decision.** The plugin builds and serves applications. It doesn't write a library: no `.d.ts` emit, no partially compiled `ɵɵngDeclare` output, no Angular Package Format bundle. A library inside a workspace compiles as part of the app that imports it, from source, through the same per-file transform, with the app's tsconfig. A library that has to be published, or consumed as a built package, keeps ng-packagr through `ng build` or `nx build`. The site's Nx page and status page say so.

**Why.** A library build is a different program: ngc in partial compilation mode, declaration emit, and a bundler that lays out the package format. ng-packagr does all of it against the same Angular version the plugin pins (`ng-packagr@22.3.0-next.2` is on npm), so there's nothing to gain from a second implementation. ngp, as the plugin uses it, is an app compiler in optimize mode; it offers no partial mode, and writing declarations is TypeScript's whole-program job, which the plugin only runs for type-checking. The main reason Nx users build libraries they never publish is incremental builds, so the app doesn't recompile them. The plugin compiles a file when it's asked for, so that reason goes away once the alias points at the source: checked on Ghostfolio, where both libraries compile with the client.

**Cost.** A workspace that publishes libraries runs two toolchains, and ng-packagr with the pinned prerelease hasn't been tried in this repo. Consuming a built library from `dist/` is untested, though the linker runs on any module with partially compiled declarations. Nothing measures an app that imports fifty libraries from source.

**Revisit when** ngp grows a partial compilation mode, or when Angular publishes ngp and ng-packagr builds on it.

## 56. tsrs as an opt-in type-checker, tsgo as the default

*17 October 2026*

**Decision.** `typeChecker: 'tsrs'` runs the plugin's type check with tsrs, Oxc's Rust port of the TypeScript 7 compiler, instead of `tsgo`. The plugin spawns it the way it spawns `tsgo`, on the same generated tsconfig with the same flags, and parses the same output; only the binary and the name of the incremental build-info file change. tsrs is an optional peer dependency the app installs, resolved from the app's root, and pinned in the plugin's devDependencies (0.16.0-ts7.1.0-dev.20260929) so the tests run it. `tsgo` stays the default. The bench has an `ngp-tsrs` variant.

**Why.** tsrs accepts the plugin's tsconfig unchanged, with `extends`, `rootDirs`, `incremental` and `files`, and prints tsc's `file(line,col): error TSxxxx: message` lines, so the block-to-template mapping doesn't change and the whole option is a resolver and a file name. It's faster where the check is the cost: on the bench's 5,000-component app a planted template error reached the terminal in 1.12 s with tsrs against 1.56 s with `tsgo`, medians of 10 in one run on 17 October 2026 (`bench/results/2026-10-17-typecheck-tsrs.json`); on the 21-component playground the two were within 20 ms, because the 300 ms debounce and the watcher are most of the half second there. Opt-in rather than the default because tsrs is pre-1.0 with issues disabled upstream, tracks TypeScript 7.1's development branch where `tsgo` is pinned at 7.0.2 (so a diagnostic can differ, and the tests pin only four), ships no Intel-Mac package, and is another 24 MB binary; if the plugin installed it, every app would pay for it. Resolving it from the app, not the plugin, lets the app move its version as tsrs moves, which it does weekly.

**Cost.** Two checkers to keep working, and a second compiler whose diagnostics can differ from ngc's. The end-to-end test runs against both and skips tsrs where its binary isn't installed, so a CI runner without it proves nothing about it. Each checker's build info is a separate cache, so switching checkers starts cold.

**Revisit when** tsrs reaches 1.0 or tracks the same TypeScript release as `tsgo`, when it ships an Intel-Mac package, or when the gap on large apps is enough that the default should move.

## 57. The repo is named after the plugin

*19 October 2026*

**Decision.** The repo moves from `push-based/vite-angular` to `push-based/vite-plugin-ngp`, and the docs site from https://push-based.github.io/vite-angular/ to https://push-based.github.io/vite-plugin-ngp/. The root `package.json` is `vite-plugin-ngp-workspace` and the bench's is `vite-plugin-ngp-bench`, because a pnpm workspace can't have two packages with the plugin's name. Getting started clones into `vite-plugin-ngp/`, so the paths in its examples changed to `../vite-plugin-ngp/...`. Earlier entries here, the changelog's history and the result files in `bench/results/` keep the old name where they record what was true then. Supersedes the name in [decision 10](decisions.md).

**Why.** The package, the docs, the search results and every config snippet already say vite-plugin-ngp. "vite-angular" read as a general Vite-for-Angular project, which it isn't: it's one plugin, built on ngp.

**Cost.** GitHub redirects the old repo's web, clone and API URLs, but not GitHub Pages: every link to the old docs URL now 404s, including ones outside this repo. A clone made before the rename keeps working through the redirect until someone creates a new repo named `vite-angular` in the org. Local checkouts keep their folder name until their owners rename them.

**Revisit when** a new repo named `push-based/vite-angular` is wanted, since it would break the redirect.

## 58. The bench repo is public too

*19 October 2026*

**Decision.** `push-based/ng-hybrid-preprocessor-bench` is public. Links into it from the docs site, the README and `bench/README.md` drop their "private" label, and the rule to keep them few is gone. Supersedes the bench half of [decision 47](decisions.md).

**Why.** The Performance and Benchmarks pages lean on it: the generated apps come from its generator, and the Comparison page cites its Analog audit. A reader who couldn't open those links had to take the claims on trust.

**Cost.** Its docs, spikes and results are published as they are, written when they weren't meant for outside readers. Earlier entries here and the changelog's history still call it private where they record what was true then.

## 59. Publish to npm the PushBased way: Nx release, conventional commits, trusted publishing

*20 October 2026*

**Decision.** Release `vite-plugin-ngp` with the setup PushBased uses across its repos, copied from push-based/zod2nx-schema: `nx release` with conventional commits, a hand-started Release workflow that tags and creates the GitHub release as the PushBased Bot app, and a Publish workflow that publishes to npm through a trusted publisher (OIDC) in the `release` environment. Nx is added for releasing only: builds and tests still run through pnpm scripts. Commit messages are checked by commitlint, locally by a husky commit-msg hook and on pull request titles in CI. The workflows use pnpm, not npm. pnpm 10 packs the package and hands the tarball to `npm publish`, so npm still does the OIDC exchange. [docs/releasing.md](releasing.md) has the steps.

**Why.** It's the org's convention, so anyone at PushBased who has released another package can release this one, and the npm and GitHub settings match what they've set up before. Trusted publishing means no npm token is stored anywhere, and every version gets provenance.

**Cost.** Nx and commitlint add about 360 packages to the root `devDependencies`, used only to release and to check commit messages. Every commit message now follows a format, which the history before this entry doesn't. The package still doesn't contain ngp, so installing it from npm doesn't save users the `pnpm toolchain` build.

**Revisit when** ngp is published, or the plugin ships an ngp build itself, since either changes what goes in the package.

## 60. ngp ships inside the plugin's package, with a native engine for four platforms

*20 October 2026*

**Decision.** The `vite-plugin-ngp` package carries ngp in `ngp/`: the TypeScript backend, the wasm engine, and native engines for `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64`, in `engines/native/<platform>-<arch>/`. The Publish workflow builds each native engine on its own runner (macOS 15 on arm64 and Intel, Ubuntu 22.04 on x64 and arm64), loads each one there, and assembles the bundle with `toolchain/bundle.mjs`. When neither `toolchain` nor `NGP_TOOLCHAIN` is set, the plugin loads the bundled build. The engine default stays `native`, with no fallback to wasm, as [decision 6](decisions.md) set it: on a platform without a bundled engine, musl Linux included, the plugin stops and says to set `engine: 'wasm'`. `toolchain/out` keeps its layout, with the host's engine directly in `engines/native/`, and the plugin still loads that. Supersedes the "package doesn't contain ngp" part of [decision 59](decisions.md).

**Why.** Without ngp in the package, installing from npm saved users nothing: they still cloned the repo and ran a Rust build. One package, not a main package plus one per platform as esbuild does, keeps one trusted publisher and one first publish by hand on npm, and one version to keep in step.

**Cost.** Every install downloads all four engines. One engine packed to 3.4 MB, so four should come to about 10 MB, against about 5 MB for a per-platform split. Each release runs four Rust builds, and every plugin release ships ngp again even when `ANGULAR_SHA` hasn't moved. The Linux engines need glibc 2.35 or newer. The first version can't be published from a laptop, which only has its own engine, so it's published by hand from the tarball CI builds.

**Revisit when** Angular publishes ngp, or when the package size becomes a complaint: then split the native engines into per-platform packages under `optionalDependencies`.

## 61. The npm package is @push-based/vite-plugin-ngp

*21 October 2026*

**Decision.** Publish the plugin as `@push-based/vite-plugin-ngp`, not as the unscoped `vite-plugin-ngp`. The repo, the folder `packages/vite-plugin-ngp`, the Vite plugin's `name` and the Nx project name (set by the `nx` field in the package's `package.json`, so commit scopes and `nx.json` don't change) keep the short name. The package's `publishConfig` sets `access: public`, since npm publishes a scoped package as private otherwise. Supersedes the package name in [decision 57](decisions.md).

**Why.** On npm only a scoped package belongs to an org. Unscoped, it would belong to whoever published it first, and the org could only be added as further owners one user at a time. `@push-based/zod2nx-schema` and `@push-based/angular-toolkit-mcp` are scoped the same way, and [decision 59](decisions.md) follows the org's conventions. The ngp build inside the package ([decision 60](decisions.md)) is unaffected.

**Cost.** Vite plugins are usually unscoped `vite-plugin-*` packages, and that's where people search. Every import in the docs, the playground, the site and the bench changed, and anyone who installed from a clone changes one import. `v0.1.0` was tagged under the old name before the rename and never published; its GitHub release was deleted and the tag kept, so the first version on npm is `0.2.0`.

## 62. Building ngp is a contributor doc, not a page on the site

*21 October 2026*

**Decision.** The site's Building ngp page and the clone-and-build steps in Getting started and the README are gone. The site documents installing from npm only. Building ngp in a clone, the build inside the package and what to do when a build fails are in [docs/building.md](building.md), which the README links for anyone running the playground or working on the plugin.

**Why.** Since 0.2.0 the npm package carries ngp ([decision 60](decisions.md#60-ngp-ships-inside-the-plugins-package-with-a-native-engine-for-four-platforms)), so no user of the plugin needs Rust, a C compiler or `pnpm toolchain`. A page about it in the site's sidebar made the setup look harder than it is.

**Cost.** Someone who wants an ngp build from another Angular commit, the one reason left to set `toolchain`, finds how to make one only from the repo. The Benchmarks page still starts from `pnpm toolchain`, because reproducing the bench means running the repo.

## 63. Link with a port of the CLI's oxc linker

*9 November 2026. Replaces 12.*

**Decision.** The plugin links `node_modules` with Angular's `FileLinker`, from the public `@angular/compiler-cli/linker` entry point, driven by an oxc `AstHost` and a string-emitting `AstFactory` in [linker-oxc.ts](../packages/vite-plugin-ngp/src/linker-oxc.ts). Both are ports of the pair the CLI keeps in `@angular/build`'s private tree (`src/tools/angular/linker/`, MIT), about 560 lines in all. [linker.ts](../packages/vite-plugin-ngp/src/linker.ts) parses a module once with Vite's `parseSync`, walks its call expressions, hands each `ɵɵngDeclare` call to the linker and splices the string it gets back into the source with magic-string. The declaration scope is the CLI's inline one: a declaration's constants stay in a pure IIFE around its definition rather than moving to module scope. `@babel/core` left the package's dependencies. The plugin's wiring didn't change: the same `link` runs in dependency pre-bundling, in builds, in server bundles and under Vitest.

**Why.** Babel was the slow part of linking, and linking is most of the cold start ([performance](../site/content/performance.md)). The linker core is parser-agnostic, so the cost of dropping Babel was only the host and factory. Measured in one Node process on 9 November 2026, over the 21 partially compiled fesm2022 modules of the Angular packages installed in this repo (626 kB): Babel took about 225 ms warm per pass and 298 ms for the first module; the oxc path about 75 ms and 36 ms. The output is the same size, and the playground's production bundle came out byte for byte identical after minification. Importing the CLI's own copy was the alternative, and it's worse on every axis: `@angular/build`'s exports map doesn't expose the file, so it would be reached by absolute path; the package pulls in rolldown, esbuild and still `@babel/core`; and it carries no semver guarantee. The port depends only on the public linker API.

**Cost.** Two files to keep in step with the CLI's if the `AstHost` or `AstFactory` interfaces change; the optimizer already carries the same kind of port ([decision 24](#24-port-the-clis-build-optimizer-in-builds-only)). Source maps for linked modules come from magic-string's ranges rather than the linker's own mapping, so a position inside a linked definition maps to the start of the declaration call, as it did with `sourceMapping: false` before. The bench hasn't been rerun, so the cold-start figures on the site still describe the Babel linker and say so.
