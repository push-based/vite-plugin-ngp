import * as fs from 'node:fs';
import {isBuiltin} from 'node:module';
import * as path from 'node:path';
import {
  isRunnableDevEnvironment,
  transformWithOxc,
  type DepOptimizationOptions,
  type DevEnvironment,
  type EnvironmentModuleGraph,
  type EnvironmentModuleNode,
  type Plugin,
  type ResolvedConfig,
  type Rolldown,
  type UserConfig,
  type ViteDevServer,
} from 'vite';
import {findAngularLibraries, packagePathPattern, packagePattern} from './angular-libraries.js';
import {budgetsPlugin, type Budget} from './budgets.js';
import {NgpCompiler, type ComponentStyle, type HmrUpdate, type TransformResult} from './compiler.js';
import {writeEntryTsconfig} from './entry-tsconfig.js';
import {i18nPlugin, type I18nOptions} from './i18n.js';
import {link, LINKER_MARKER} from './linker.js';
import {isSideEffectFree, optimize, OPTIMIZER_CANDIDATE} from './optimizer.js';
import {resolveToolchain, type Engine} from './ngp-api.js';
import {polyfillsPlugin, usesZone, zoneAsyncPlugin} from './polyfills.js';
import {
  buildReport,
  FIRST_CHECK_QUIET_MS,
  OVERLAY_CLIENT,
  OVERLAY_CLIENT_ID,
  OVERLAY_CLIENT_URL,
  ServerActivity,
  startDevTypeCheck,
  TypeChecker,
  type TypeCheckResult,
} from './type-check.js';
import {rewriteToUrls, stylesPlugin, type StylesPluginContext} from './styles.js';

export type {Budget} from './budgets.js';

export interface NgpPluginOptions {
  /**
   * Directory holding an ngp build: `preprocessor/api.js` and `engines/`. Defaults to the
   * NGP_TOOLCHAIN environment variable, then to the build bundled in the published package.
   */
  toolchain?: string;
  /** Analyzer engine. Defaults to `native`, with no fallback to wasm. */
  engine?: Engine;
  /**
   * The app's tsconfig, relative to Vite's root. Defaults to tsconfig.app.json, else tsconfig.json.
   * Under Vitest, tsconfig.spec.json comes first.
   */
  tsconfig?: string;
  /**
   * Entry modules, relative to Vite's root. Defaults to `src/main.ts`, plus `src/main.server.ts`
   * when it exists. Under Vitest it defaults to none: the analyzer reads each spec, and what it
   * imports, when Vitest asks for it.
   */
  entries?: string[];
  /**
   * Give the analyzer a generated tsconfig that lists only `entries`, which keeps edits from
   * costing time proportional to project size. Defaults to true.
   */
  entryOnlyTsconfig?: boolean;
  /**
   * Component HMR in the dev server: edits to an external template, and `.ts` edits that only
   * change a component's inline `template` or `styles`, update the running component in place.
   * Defaults to true. Ignored in builds.
   */
  hmr?: boolean;
  /**
   * Server-side rendering. Ignored under Vitest. The entry module default-exports
   * `render(url: string, document: string): Promise<string>`, which turns index.html into the
   * rendered page. In dev, the plugin renders every page request through it. `vite build` then
   * builds the client into `dist/client` and the entry into `dist/server`. `true` means the entry
   * is `src/main.server.ts`. Off by default.
   */
  ssr?: boolean | {entry?: string};
  /**
   * Type-check templates and TypeScript: TypeScript 7 (`tsgo`) checks the app's sources together
   * with ngp's type-check blocks, in a child process, and errors in a block are reported at their
   * template location. In dev, errors show in the terminal and Vite's error overlay after each
   * edit, without holding up transforms or HMR. `vite build` fails on any error. Defaults to true,
   * except under Vitest.
   */
  typeCheck?: boolean;
  /**
   * Which TypeScript 7 runs the check: `tsgo`, Microsoft's Go port, which the plugin installs, or
   * `tsrs`, Oxc's Rust port, which your app installs (`npm install -D tsrs`). Defaults to `tsgo`.
   */
  typeChecker?: 'tsgo' | 'tsrs';
  /**
   * Swap source files, like angular.json's `fileReplacements`: every import of `replace` gets the
   * content of `with`, in Vite and in ngp's analyzer. Paths are relative to Vite's root. Applies in
   * dev and in builds, so pick the list by `mode` in your Vite config.
   */
  fileReplacements?: {replace: string; with: string}[];
  /**
   * Size budgets checked after `vite build`, in angular.json's format. A `maximumError` breach
   * fails the build, a `maximumWarning` breach logs a warning.
   */
  budgets?: Budget[];
  /**
   * Modules imported before the app, like angular.json's `polyfills`: package names or files
   * relative to Vite's root. `zone.js` also loads `zone.js/node` on the server, and makes the
   * plugin rewrite `async`/`await` so zone.js can track it.
   */
  polyfills?: string[];
  /**
   * Angular i18n: `i18n` attributes and `$localize`. `vite build` writes one folder per locale,
   * translated at build time. The dev server serves `devLocale`, translated at runtime. Off by
   * default: without it, `$localize` messages need `@angular/localize/init` loaded by the app.
   */
  i18n?: I18nOptions;
}

/** What the compiler plugin shares with the other plugins. */
interface CompilerApi extends StylesPluginContext {
  /** The entry modules, as absolute paths. */
  entries(): string[];
  /** Each component stylesheet in an app module, from the browser compiler's analyzer. */
  componentStyles(file: string): Promise<ComponentStyle[]>;
}

/** File replacements, both ways, as absolute paths. Filled in once Vite's root is known. */
interface Replacements {
  /** Replaced file to replacement. */
  byFile: Map<string, string>;
  /** Replacement to replaced file. */
  byReplacement: Map<string, string>;
}

export type {I18nOptions} from './i18n.js';
export {extractMessages, type ExtractOptions} from './extract.js';

type Consumer = 'client' | 'server';
type RolldownPlugin = Rolldown.Plugin;

/**
 * The slice of Vitest's `configureVitest` hook this plugin uses, typed by hand so the plugin
 * doesn't depend on Vitest.
 */
interface VitestPluginContext {
  vitest: {watcher: {onFileChange(file: string): void}};
  /** Called only when Vitest's fsModuleCache is on. `false` keeps a module out of the cache. */
  defineCacheKeyGenerator(generator: (context: {id: string}) => string | false | undefined): void;
}

/** A change to a `.ts` file, as the watcher reported it. */
interface TsEdit {
  at: number;
  content: string | undefined;
  /** Whether the browser's hotUpdate applied the change in place. */
  inPlace: Promise<boolean>;
  settle: (inPlace: boolean) => void;
}

const TS_MODULE = /\.[cm]?ts$/;
/** `DEBUG=vite-plugin-ngp` logs every module ngp compiles, with its time. */
const debug = /(?:^|,)vite-plugin-ngp(?:,|$)/.test(process.env['DEBUG'] ?? '');

/**
 * Times the steps of one template update, for `DEBUG=vite-plugin-ngp`. The first step is the
 * watcher's: from the file's write to its report.
 */
class Spans {
  private last = performance.now();
  private readonly parts: string[];
  constructor(file: string) {
    const written = fs.statSync(file, {throwIfNoEntry: false})?.mtimeMs ?? Date.now();
    this.parts = [`watcher ${(Date.now() - written).toFixed(1)}`];
  }
  lap(name: string) {
    const now = performance.now();
    this.parts.push(`${name} ${(now - this.last).toFixed(1)}`);
    this.last = now;
  }
  toString() {
    return this.parts.join(', ') + ' ms';
  }
}

/**
 * How long after its write a template update waits for the rest of its save. An editor saving all
 * files, a git checkout or a rename across files writes them within a few milliseconds.
 */
const EDIT_BATCH_MS = 50;

/**
 * How long a template update waits for the watcher to report a class change that's already on
 * disk. FSEvents on macOS can report one save's files about 100 ms apart.
 */
const PENDING_EDIT_MS = 1000;

export function ngp(options: NgpPluginOptions = {}): Plugin[] {
  const replacements: Replacements = {byFile: new Map(), byReplacement: new Map()};
  const compiler = compilerPlugin(options, replacements);
  // With i18n, the plugin loads `$localize` itself in dev, and builds translate it away, so a
  // `@angular/localize` polyfill is dropped, as the CLI drops it when it inlines translations.
  const polyfills = (options.polyfills ?? []).filter((p) => !(options.i18n && p.startsWith('@angular/localize')));
  return [
    compiler,
    ...(options.fileReplacements?.length ? [fileReplacementsPlugin(options.fileReplacements, replacements)] : []),
    // Measures component stylesheets before the styles plugin scopes them.
    ...(options.budgets?.length ? [budgetsPlugin(options.budgets, compiler.api)] : []),
    stylesPlugin(compiler.api),
    linkerPlugin(),
    optimizerPlugin(),
    ...(polyfills.length > 0 ? [polyfillsPlugin(polyfills, () => compiler.api.entries())] : []),
    ...(usesZone(polyfills) ? [zoneAsyncPlugin()] : []),
    ...(options.i18n ? [i18nPlugin(options.i18n, () => compiler.api.entries(), !!options.ssr && !isVitest())] : []),
  ];
}

function compilerPlugin(
  options: NgpPluginOptions,
  replacements: Replacements,
): Plugin<CompilerApi> & {api: CompilerApi; configureVitest(context: VitestPluginContext): void} {
  let config: ResolvedConfig;
  let vitest: VitestPluginContext['vitest'] | null = null;
  let entries: string[] = [];
  /**
   * One compiler per consumer. Server environments get their own, compiled without HMR: HMR code
   * imports update modules from URLs that only a browser can load.
   */
  const compilers = new Map<Consumer, Promise<NgpCompiler>>();
  let serve = false;
  let hmr = false;
  let root = process.cwd();
  /** Under Vitest: specs are compiled like any other module, with no HMR and no SSR. */
  const testing = isVitest();
  const ssrOptions = testing ? null : options.ssr === true ? {} : options.ssr || null;
  const ssrEntry = ssrOptions ? (ssrOptions.entry ?? 'src/main.server.ts') : null;
  /**
   * Latest update module per component, served at `/@ng/component?c=<id>`. Keyed by the decoded
   * id (`src/app/home.ts@Home`), which is what the `c` query parameter decodes to.
   */
  const componentUpdates = new Map<string, string>();
  const typeCheck = options.typeCheck ?? !testing;
  const typeChecker = options.typeChecker ?? 'tsgo';
  if (typeChecker !== 'tsgo' && typeChecker !== 'tsrs') {
    throw new Error(`[vite-plugin-ngp] typeChecker must be 'tsgo' or 'tsrs', not ${JSON.stringify(typeChecker)}`);
  }
  const engine = options.engine ?? 'native';
  if (engine !== 'native' && engine !== 'wasm') {
    throw new Error(`[vite-plugin-ngp] engine must be 'native' or 'wasm', not ${JSON.stringify(engine)}`);
  }
  let checker: TypeChecker | null = null;
  let devCheck: ReturnType<typeof startDevTypeCheck> | null = null;
  /** Requests and compiles in flight: the first type-check waits until there are none. */
  const activity = new ServerActivity(FIRST_CHECK_QUIET_MS);
  let typeCheckOverlay = false;
  let buildCheck: Promise<TypeCheckResult> | null = null;
  /**
   * Files whose last compile for the browser failed. Their components aren't running, so an edit
   * can't update them in place: the page has to reload.
   */
  const failed = new Set<string>();
  /**
   * Orders the two events below: `++clock` is later than every number handed out before it.
   */
  let clock = 0;
  /** Each `.ts` file as the browser last loaded it: when, and its content on disk. */
  const loads = new Map<string, {at: number; content: string}>();
  /**
   * Each `.ts` file's latest change, as the watcher reported it. `inPlace` settles once the
   * browser's hotUpdate knows whether the change was applied in place, so a template edited in the
   * same save can wait for the answer.
   */
  const tsEdits = new Map<string, TsEdit>();
  /** When Vite read each module, by environment and id, from load until its transform. */
  const readAt = new Map<string, number>();
  /** Template updates waiting for the watcher to report a `.ts` change. */
  const editWaiters = new Map<string, Set<() => void>>();
  /**
   * The latest report being recorded for each `.ts` file. Reports for one file are recorded one
   * after another, so each reads the file only once the one before has finished.
   */
  const recordings = new Map<string, Promise<void>>();

  /** Records a `.ts` change the watcher reported, unless it repeats the content already seen. */
  async function recordEdit(tsFile: string) {
    // Not a plain read: a read between the save's truncate and its write would record an empty
    // file, which then never matches disk.
    const content = await readWritten(tsFile);
    // FSEvents on macOS reports some writes twice, about 100 ms apart. A report with nothing new
    // in it isn't a change, and mustn't replace the outcome of the change it repeats.
    if (content !== undefined && content === lastSeen(tsFile)) {
      return;
    }
    tsEdits.get(tsFile)?.settle(false);
    let settle!: (inPlace: boolean) => void;
    const inPlace = new Promise<boolean>((resolve) => (settle = resolve));
    tsEdits.set(tsFile, {at: ++clock, content, inPlace, settle});
    for (const waiter of [...(editWaiters.get(tsFile) ?? [])]) {
      waiter();
    }
  }

  /** The latest content the plugin has seen for a `.ts` file, from a load or a change. */
  function lastSeen(tsFile: string): string | undefined {
    const edit = tsEdits.get(tsFile);
    const load = loads.get(tsFile);
    return edit && (!load || edit.at > load.at) ? edit.content : load?.content;
  }

  /** Resolves when the watcher reports a change to `tsFile`, or after `ms`. */
  function nextTsEdit(tsFile: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const waiters = editWaiters.get(tsFile) ?? new Set();
      editWaiters.set(tsFile, waiters);
      const done = () => {
        waiters.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiters.add(done);
    });
  }

  /**
   * Whether the class on the page fits an edited template. `reloading` when the class changed
   * after the page last loaded it and the change wasn't applied in place: the template may use
   * members the page's class doesn't have yet, and the class's own change reloads the page. A
   * change already on disk that the watcher hasn't reported yet is waited for, and `unknown` when
   * it never comes.
   */
  async function pageClass(tsFile: string): Promise<'current' | 'reloading' | 'unknown'> {
    const disk = await readWritten(tsFile);
    const seen = lastSeen(tsFile);
    if (disk !== undefined && seen !== undefined && disk !== seen) {
      await nextTsEdit(tsFile, PENDING_EDIT_MS);
      if (lastSeen(tsFile) !== disk) {
        return 'unknown';
      }
    }
    const edit = tsEdits.get(tsFile);
    if (!edit || edit.at < (loads.get(tsFile)?.at ?? 0)) {
      return 'current';
    }
    // A hotUpdate that never ran, or threw, counts as a reload.
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000).unref());
    return (await Promise.race([edit.inPlace, timeout])) ? 'current' : 'reloading';
  }

  /** One check over every file the tsconfig includes, plus any other the compiler has compiled. */
  async function runTypeCheck(): Promise<TypeCheckResult> {
    checker ??= new TypeChecker({
      tsconfig: resolveTsconfig(config.root, options.tsconfig, testing),
      outDir: path.join(config.cacheDir, 'vite-plugin-ngp/type-check'),
      cwd: config.root,
      checker: typeChecker,
    });
    // The browser's compiler: type-check blocks don't depend on HMR, and it always exists.
    const ngp = await getCompiler('client');
    const files = new Set([...checker.programFiles(), ...ngp.knownFiles().filter((f) => TS_MODULE.test(f))]);
    return checker.check(await ngp.typeCheckBlocks(files));
  }

  function getCompiler(consumer: Consumer): Promise<NgpCompiler> {
    let compiler = compilers.get(consumer);
    compiler ??= (async () => {
      const toolchainDir = resolveToolchain(options.toolchain);
      const tsconfig = resolveTsconfig(config.root, options.tsconfig, testing);
      const analyzerTsconfig =
        options.entryOnlyTsconfig === false
          ? tsconfig
          : await writeEntryTsconfig({tsconfig, entries, outDir: path.join(config.cacheDir, 'vite-plugin-ngp')});
      return NgpCompiler.create({
        toolchainDir,
        engine,
        tsconfig,
        analyzerTsconfig,
        enableHmr: hmr && consumer === 'client',
        fileReplacements: replacements.byFile,
      });
    })();
    compilers.set(consumer, compiler);
    return compiler;
  }

  /**
   * Watch mode under Vitest. Vitest turns Vite's HMR off, so `hotUpdate` never runs, but the
   * analyzer still has to see each edit, and every module whose output it changes has to be
   * compiled again. Vitest reruns the specs that import an edited module. A template isn't a
   * module, so for a template edit the plugin tells Vitest its component changed.
   */
  async function onTestEdit(server: ViteDevServer, file: string) {
    if (!(TS_MODULE.test(file) || file.endsWith('.html')) || compilers.size === 0 || replacements.byFile.has(file)) {
      return;
    }
    // Read synchronously, so the update is queued before Vitest's debounced rerun transforms.
    const content = fs.readFileSync(file, 'utf8');
    let owner: string | null = null;
    for (const [consumer, compiler] of compilers) {
      const ngp = await compiler;
      const replacedFile = replacements.byReplacement.get(file);
      const {stale} = await ngp.update(replacedFile ?? file, content, 'watcher');
      if (replacedFile) {
        stale.push(replacedFile);
      }
      owner ??= file.endsWith('.html') ? await ngp.componentForTemplate(file) : null;
      for (const environment of Object.values(server.environments)) {
        if (environment.config.consumer !== consumer) {
          continue;
        }
        for (const f of new Set([...stale, ...(owner ? [owner] : [])])) {
          for (const mod of environment.moduleGraph.getModulesByFile(f) ?? []) {
            environment.moduleGraph.invalidateModule(mod);
          }
        }
      }
    }
    if (owner) {
      vitest?.watcher.onFileChange(owner);
    }
  }

  async function closeCompilers() {
    const current = [...compilers.values()];
    compilers.clear();
    for (const compiler of current) {
      (await compiler.catch(() => null))?.close();
    }
  }

  /** Stores update modules, invalidates `tsFile` without a reload, and tells the page. */
  async function sendUpdates(environment: DevEnvironment, tsFile: string, updates: HmrUpdate[], timestamp: number, spans?: Spans) {
    for (const update of updates) {
      // Update modules name external stylesheets by path too.
      const js = await transformWithOxc(rewriteToUrls(update.code).code, `${tsFile}.hmr.ts`, {lang: 'ts'});
      componentUpdates.set(decodeURIComponent(update.id), js.code);
    }
    spans?.lap('transform');
    // Invalidate without reloading, so the next full load compiles the new code.
    const graph = environment.moduleGraph;
    for (const mod of graph.getModulesByFile(tsFile) ?? []) {
      graph.invalidateModule(mod, new Set(), timestamp, true);
    }
    for (const update of updates) {
      environment.hot.send({type: 'custom', event: 'angular:component-update', data: {id: update.id, timestamp}});
      config.logger.info(`hmr update ${decodeURIComponent(update.id)}`, {timestamp: true});
    }
    if (spans) {
      spans.lap('send');
      process.stderr.write(`vite-plugin-ngp hmr ${path.relative(config.root, tsFile)}: ${spans}\n`);
    }
  }

  /**
   * Sends an edited template to the running component, or reloads the page when it can't. An
   * update module runs against the class already on the page. If the class changed too, the new
   * template may use members the page's class doesn't have yet, so the class's own change reloads
   * the page instead. A `.ts` change that was itself applied in place left the class as it was,
   * so the template update still goes out.
   */
  async function updateTemplate(
    environment: DevEnvironment,
    ngp: NgpCompiler,
    file: string,
    owner: string,
    stale: string[],
    timestamp: number,
    spans?: Spans,
  ) {
    const graph = environment.moduleGraph;
    const invalidate = () => {
      for (const f of new Set([...stale, owner])) {
        for (const mod of graph.getModulesByFile(f) ?? []) {
          graph.invalidateModule(mod);
        }
      }
    };
    // Counted from the write, not the watcher's report: on macOS the report alone often takes
    // longer than the window.
    const written = (await fs.promises.stat(file).catch(() => null))?.mtimeMs ?? Date.now();
    // Timed apart from the wait: on a starved machine the stat alone has taken 26 ms.
    spans?.lap('stat');
    const wait = Math.min(EDIT_BATCH_MS, written + EDIT_BATCH_MS - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    spans?.lap('wait');
    const page = await pageClass(owner);
    spans?.lap('class');
    if (page === 'reloading') {
      // The page reloads for the class change, and then loads this template with it.
      invalidate();
      return;
    }
    try {
      if (page === 'unknown') {
        throw new Error(`${path.basename(owner)} changed on disk, and the watcher never reported it`);
      }
      const updates = await ngp.hmrUpdates(owner, file);
      spans?.lap('emit');
      if (updates.length > 0) {
        await sendUpdates(environment, owner, updates, timestamp, spans);
        return;
      }
    } catch (error) {
      config.logger.error(`[vite-plugin-ngp] HMR update for ${file} failed, reloading: ${String(error)}`);
    }
    invalidate();
    environment.hot.send({type: 'full-reload'});
  }

  /**
   * Applies a `.ts` edit in place if it only changed components' inline `template` or `styles`.
   * Resolves to false when the edit needs a page reload.
   */
  async function updateInline(
    environment: DevEnvironment,
    ngp: NgpCompiler,
    file: string,
    previous: string,
    content: string,
    timestamp: number,
  ): Promise<boolean> {
    try {
      const updates = await ngp.inlineHmrUpdates(file, previous, content);
      if (!updates) {
        return false;
      }
      // No updates: the edit changed only trivia that no component depends on.
      await sendUpdates(environment, file, updates, timestamp);
      return true;
    } catch (error) {
      // Vite drops errors thrown from hotUpdate silently. Say so, and reload instead.
      config.logger.error(`[vite-plugin-ngp] HMR update for ${file} failed, reloading: ${String(error)}`);
      return false;
    }
  }

  return {
    name: 'vite-plugin-ngp',
    api: {
      getCompiler,
      hmr: () => hmr,
      linkStyles: () => config.command === 'serve' && !testing,
      entries: () => entries,
      async componentStyles(file) {
        const compiler = compilers.get('client');
        return compiler ? (await compiler).componentStyles(file) : [];
      },
    },
    // Before Vite's own TypeScript transform: ngp returns TypeScript, and Vite strips the types.
    enforce: 'pre',

    // The same compile-time globals the Angular CLI defines, so Angular can drop dev-only and JIT
    // code. The linker makes every library AOT, so JIT is never needed.
    config(userConfig, env) {
      serve = env.command === 'serve';
      hmr = serve && options.hmr !== false && !testing;
      root = path.resolve(userConfig.root ?? process.cwd());
      if (testing) {
        // Vitest leaves node_modules to Node, which would load Angular libraries unlinked, and
        // they'd need the JIT compiler. Inlining them sends them through the linker, and keeps
        // one copy of @angular/core. Tests use devDependencies too.
        const inline = [
          /[\\/]node_modules[\\/]@angular[\\/]/,
          ...findAngularLibraries(root, {devDependencies: true}).map(packagePathPattern),
        ];
        return {define: {ngJitMode: 'false', ngHmrMode: 'false'}, test: {server: {deps: {inline}}}} as UserConfig;
      }
      return {
        define: {
          ngJitMode: 'false',
          // `$localize`, never Closure's goog.getMsg, for i18n messages.
          ngI18nClosureMode: 'false',
          ngHmrMode: String(hmr),
          ...(env.command === 'build' ? {ngDevMode: 'false'} : {}),
        },
        ...(ssrEntry && {
          // `vite build` builds every environment: the browser bundle and the server entry.
          builder: {},
          environments: {
            client: {build: {outDir: 'dist/client'}},
            ssr: {build: {outDir: 'dist/server', rolldownOptions: {input: ssrEntry}}},
          },
        }),
      };
    },

    configEnvironment(name, environment) {
      if ((environment.consumer ?? (name === 'client' ? 'client' : 'server')) === 'client') {
        return {define: {ngServerMode: 'false'}};
      }
      // Server environments externalize node_modules by default, and Node would then load Angular
      // libraries unlinked, which needs the JIT compiler. Bundling them runs the linker, and keeps
      // a single copy of @angular/core.
      const noExternal = [/^@angular\//, ...findAngularLibraries(root).map(packagePattern)];
      return {
        define: {ngServerMode: 'true', ngHmrMode: 'false'},
        resolve: {noExternal},
        // In the dev server, pre-bundle those libraries once, linked, into the cache directory,
        // instead of linking and transforming them again on every start.
        ...(serve && !testing && ssrEntry && name === 'ssr' ? {optimizeDeps: serverOptimizeDeps(noExternal)} : {}),
      };
    },

    configResolved(resolved) {
      config = resolved;
      entries = (options.entries ?? (testing ? [] : ['src/main.ts', 'src/main.server.ts']))
        .map((e) => path.resolve(config.root, e))
        .filter((e) => options.entries || fs.existsSync(e));
      for (const {replace, with: replacement} of options.fileReplacements ?? []) {
        const from = path.resolve(config.root, replace);
        const to = path.resolve(config.root, replacement);
        // The CLI's check and message.
        if (!fs.existsSync(to)) {
          throw new Error(`The ${to} path in file replacements does not exist.`);
        }
        replacements.byFile.set(from, to);
        replacements.byReplacement.set(to, from);
      }
    },

    configureVitest(context) {
      vitest = context.vitest;
      // Vitest caches transformed modules on disk, keyed by the module's own content. A compiled
      // component also depends on its template, its styles, and the components it imports, so
      // the app's modules are compiled fresh on every run. Linked libraries are still cached.
      context.defineCacheKeyGenerator(({id}) => (isAppModule(id) ? false : undefined));
    },

    configureServer(server) {
      if (testing) {
        server.watcher.on('change', (file) => {
          onTestEdit(server, file).catch((error) => {
            config.logger.error(`[vite-plugin-ngp] ${file}: ${String(error)}`);
          });
        });
        return;
      }
      server.httpServer?.once('close', closeCompilers);
      if (typeCheck) {
        const viteHmr = server.config.server.hmr;
        typeCheckOverlay = viteHmr !== false && (typeof viteHmr !== 'object' || viteHmr.overlay !== false);
        devCheck = startDevTypeCheck({
          server,
          activity,
          run: runTypeCheck,
          filesChanged: () => checker?.filesChanged(),
          abort: () => checker?.abort(),
          overlay: typeCheckOverlay,
        });
      }
      // Runs after Vite's own middlewares, once its SPA fallback has rewritten a page request to
      // /index.html, and before Vite would serve that file as it is.
      const renderPages = () => {
        if (!ssrEntry) {
          return;
        }
        server.middlewares.use(async (req, res, next) => {
          const accept = req.headers.accept ?? '';
          if (req.method !== 'GET' || !cleanId(req.url ?? '').endsWith('.html') || !accept.includes('text/html')) {
            return next();
          }
          const url = req.originalUrl ?? req.url ?? '/';
          try {
            const environment = server.environments.ssr;
            if (!isRunnableDevEnvironment(environment)) {
              throw new Error('the ssr environment has no module runner');
            }
            const template = await fs.promises.readFile(path.join(config.root, cleanId(req.url!)), 'utf8');
            const document = await server.transformIndexHtml(url, template, req.originalUrl);
            const entry = await environment.runner.import<{default: (url: string, document: string) => Promise<string>}>(ssrEntry);
            const html = await entry.default(url, document);
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          } catch (error) {
            server.ssrFixStacktrace(error as Error);
            next(error);
          }
        });
      };
      if (!hmr) {
        return renderPages;
      }
      // Compiled components import their update module from `<module dir>/@ng/component?c=<id>`,
      // once at startup and again after each angular:component-update. No update means an empty
      // module, and that has to be instant: every component on the page asks at startup.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.includes('/@ng/component')) {
          return next();
        }
        const id = new URL(req.url, 'http://localhost').searchParams.get('c');
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.end((id && componentUpdates.get(id)) ?? '');
      });
      // Angular's runtime sends this when it can't apply an update.
      server.environments.client.hot.on('angular:invalidate', (data: {id?: string; message?: string}) => {
        config.logger.warn(`[vite-plugin-ngp] HMR failed for ${decodeURIComponent(data.id ?? '?')}: ${data.message ?? ''}. Reloading.`);
        server.environments.client.hot.send({type: 'full-reload'});
      });
      return renderPages;
    },

    // Type errors fail the build. The check starts once every module is transformed, and runs
    // while Rolldown renders and minifies the chunks.
    buildEnd(error) {
      if (typeCheck && !error && config.command === 'build' && this.environment.config.consumer === 'client') {
        buildCheck = runTypeCheck();
        buildCheck.catch(() => {});
      }
    },

    async generateBundle() {
      if (!buildCheck) {
        return;
      }
      const report = buildReport(await buildCheck, config.root);
      buildCheck = null;
      if (report.error) {
        this.error(report.error);
      }
      config.logger.info(report.info);
    },

    // Also runs when the dev server closes: a check still writing to the cache would outlive it.
    // Vitest closes its Vite server through here, with no HTTP server to wait for.
    async closeBundle() {
      await devCheck?.close();
      if (config.command === 'build' || testing) {
        return closeCompilers();
      }
    },

    // The dev server's overlay client for type errors.
    resolveId: {
      filter: {id: /^\/@ngp\/type-check-client\.js$/},
      handler: () => OVERLAY_CLIENT_ID,
    },
    load: {
      filter: {id: {include: [/^\0vite-plugin-ngp:type-check-client$/, TS_MODULE], exclude: [/\.d\.[cm]?ts$/, /\/node_modules\//]}},
      handler(id) {
        if (id === OVERLAY_CLIENT_ID) {
          return OVERLAY_CLIENT;
        }
        // Vite reads the file after every load hook returns nothing. transform tells the compiler
        // when, so code read before a watcher edit can't undo it.
        readAt.set(`${this.environment.name}\0${id}`, performance.now());
        return null;
      },
    },
    transformIndexHtml() {
      if (typeCheckOverlay) {
        return [{tag: 'script', attrs: {type: 'module', src: OVERLAY_CLIENT_URL}, injectTo: 'head'}];
      }
    },

    transform: {
      filter: {id: {include: TS_MODULE, exclude: [/\.d\.[cm]?ts$/, /\/node_modules\//]}},
      async handler(code, id) {
        const file = cleanId(id);
        if (hmr && this.environment.config.consumer === 'client') {
          // From disk, not `code`: the watcher's reports are compared with it, and another plugin
          // may have changed `code` already.
          const at = ++clock;
          const content = (await readWritten(file)) ?? code;
          loads.set(file, {at, content});
        }
        const ngp = await getCompiler(this.environment.config.consumer);
        if (this.environment.name === 'client') {
          failed.add(file);
        }
        const start = performance.now();
        const key = `${this.environment.name}\0${id}`;
        const at = readAt.get(key);
        readAt.delete(key);
        const compiling = activity.begin();
        let result: TransformResult | null;
        try {
          result = await ngp.transform(file, code, at);
        } finally {
          compiling();
        }
        if (debug) {
          const ms = (performance.now() - start).toFixed(1);
          // To stderr, like Vite's own DEBUG output: Vitest silences Vite's logger.
          process.stderr.write(`vite-plugin-ngp ${result ? 'compiled' : 'unchanged'} ${path.relative(config.root, file)} (${ms} ms)\n`);
        }
        // Freshly compiled code already contains any pending template update.
        const prefix = decodeURIComponent(ngp.componentId(file, ''));
        for (const componentId of componentUpdates.keys()) {
          if (componentId.startsWith(prefix)) {
            componentUpdates.delete(componentId);
          }
        }
        if (!result) {
          failed.delete(file);
          return null;
        }
        for (const d of result.diagnostics) {
          // Extended diagnostics (NG81xx) already name their code in the message; the rest don't.
          const prefixed = d.messageText.startsWith(`NG${d.code}:`) ? d.messageText : `NG${d.code}: ${d.messageText}`;
          const log = {message: prefixed, id: d.filePath ?? file, pos: d.span?.start};
          // ts.DiagnosticCategory.Error
          if (d.category === 1) {
            this.error(log);
          } else {
            this.warn(log);
          }
        }
        failed.delete(file);
        return {code: result.code, map: result.map};
      },
    },

    // Vite calls this once per environment for every change, before any hotUpdate, so a template
    // update can see a class change from the same save.
    // Vite awaits this before any hotUpdate for the change, calling it once per environment, all
    // at once. Chained, not shared: the environments' calls for one save read the same content,
    // and every call after the first is a repeat. A second save of the file that's reported while
    // the first is still being read gets its own read, after it.
    watchChange(id) {
      if (!hmr || !TS_MODULE.test(id)) {
        return;
      }
      const before = recordings.get(id)?.catch(() => {}) ?? Promise.resolve();
      const recording = before.then(() => recordEdit(id));
      recordings.set(id, recording);
      recording
        .finally(() => {
          if (recordings.get(id) === recording) {
            recordings.delete(id);
          }
        })
        .catch(() => {});
      return recording;
    },

    // Template edits, and .ts edits that only change inline templates or styles, update the
    // component in place. Every other edit returns the affected modules, and since compiled
    // components don't accept updates, Vite reloads the page.
    async hotUpdate({file, type, read, timestamp, modules}) {
      const spans = debug && file.endsWith('.html') && this.environment.name === 'client' ? new Spans(file) : undefined;
      // Each environment updates its own compiler, so the server renders the edit too.
      const compiler = compilers.get(this.environment.config.consumer);
      // The analyzer holds the replacement's content for a replaced file, so an edit to the
      // replaced file changes nothing.
      if (!compiler || !(TS_MODULE.test(file) || file.endsWith('.html')) || replacements.byFile.has(file)) {
        return;
      }
      const ngp = await compiler;
      const graph = this.environment.moduleGraph;
      if (this.environment.config.consumer === 'client') {
        devCheck?.schedule();
      }
      // The event type isn't reliable: macOS's watcher reports some new files as updates, and a
      // file can be gone by the time an update is handled. Whether it can be read decides.
      const content = type === 'delete' ? null : await Promise.resolve().then(read).catch(() => null);

      // An edit to a replacement is an edit to the file it replaces. The page reloads: the
      // analyzer only knows the replaced file's path, so there's no in-place update to make.
      const replacedFile = replacements.byReplacement.get(file);
      if (replacedFile) {
        if (content === null) {
          return;
        }
        const {stale} = await ngp.update(replacedFile, content, 'watcher');
        return invalidateAll(graph, modulesOf(graph, [...stale, replacedFile]), modules);
      }

      if (content === null) {
        tsEdits.get(file)?.settle(false);
        const stale = await ngp.remove(file);
        const prefix = decodeURIComponent(ngp.componentId(file, ''));
        for (const componentId of componentUpdates.keys()) {
          if (componentId.startsWith(prefix)) {
            componentUpdates.delete(componentId);
          }
        }
        // Every importer has to resolve its imports again, and fail now if it still imports the
        // file, whether or not the analyzer knew about the import.
        const importers = modulesOf(graph, [file]).flatMap((mod) => [...mod.importers]);
        return invalidateAll(graph, [...modulesOf(graph, stale), ...importers], modules);
      }

      spans?.lap('read');
      const {stale, previous} = await ngp.update(file, content, 'watcher');
      spans?.lap('analyze');
      const owner = file.endsWith('.html') ? await ngp.componentForTemplate(file) : null;
      spans?.lap('owner');
      // The watcher reported a write this compiler already has. The report that brought it
      // handled it.
      const repeat = previous === content;

      if (owner && hmr && this.environment.name === 'client' && !failed.has(owner)) {
        // Decided in the background: Vite runs the other environments' hotUpdate only after this
        // one returns, and the server has to see the new template before the page reloads.
        if (!repeat) {
          void updateTemplate(this.environment, ngp, file, owner, stale, timestamp, spans);
        }
        // Returning [] would make Vite reload: it treats every changed .html file with no modules
        // as a page. A node for the template that Vite has never transformed stops update
        // propagation without a reload, which is what "handled" means here.
        const url = '/' + path.relative(config.root, file).split(path.sep).join('/');
        return [await graph.ensureEntryFromUrl(url, false)];
      }

      if (TS_MODULE.test(file) && hmr && this.environment.name === 'client') {
        if (repeat) {
          // For a .ts file, no modules means handled.
          return [];
        }
        const inPlace =
          previous !== undefined &&
          !failed.has(file) &&
          (await updateInline(this.environment, ngp, file, previous, content, timestamp));
        const edit = tsEdits.get(file);
        if (edit?.content === content) {
          edit.settle(inPlace);
        }
        if (inPlace) {
          // For a .ts file, no modules means handled.
          return [];
        }
      }

      return invalidateAll(graph, modulesOf(graph, [...stale, ...(owner ? [owner] : [])]), modules);
    },
  };
}

/**
 * Gives each replaced file its replacement's content, which is what the analyzer sees too. The
 * replaced file keeps its own id, so its imports resolve from where it is.
 */
function fileReplacementsPlugin(fileReplacements: NonNullable<NgpPluginOptions['fileReplacements']>, replacements: Replacements): Plugin {
  // Matches files named like a replaced file, so the hook runs for little else.
  const names = fileReplacements.map((r) => path.basename(r.replace).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return {
    name: 'vite-plugin-ngp:file-replacements',
    enforce: 'pre',
    load: {
      filter: {id: new RegExp(`[\\/](?:${names.join('|')})(?:$|\\?)`)},
      async handler(id) {
        const replacement = replacements.byFile.get(cleanId(id));
        if (!replacement) {
          return null;
        }
        this.addWatchFile(replacement);
        return fs.promises.readFile(replacement, 'utf8');
      },
    },
  };
}

const LINKER_FILTER = {
  id: {include: /\.[cm]?js$/, exclude: /[\\/]node_modules[\\/]\.vite[\\/]/},
  code: LINKER_MARKER,
};

/** The linker as a Rolldown plugin, for Vite's dependency pre-bundling. */
function linkerRolldownPlugin(): RolldownPlugin {
  return {name: 'vite-plugin-ngp:linker', transform: {filter: LINKER_FILTER, handler: (code: string, id: string) => link(code, id) as never}};
}

/** Runs Angular's linker on library code, both where Vite pre-bundles it and where it doesn't. */
function linkerPlugin(): Plugin {
  return {
    name: 'vite-plugin-ngp:linker',
    config() {
      // In dev, Vite pre-bundles the client's dependencies with Rolldown, outside the plugin
      // pipeline. This reaches the client environment only; server environments get theirs from
      // `configEnvironment`.
      return {optimizeDeps: {rolldownOptions: {plugins: [linkerRolldownPlugin()]}}};
    },
    // Production builds, and dependencies Vite serves without pre-bundling.
    transform: {filter: LINKER_FILTER, handler: (code, id) => link(code, id) as never},
  };
}

/**
 * Dependency pre-bundling for the `ssr` environment in the dev server. Vite turns it off for
 * server environments: Node loads `node_modules` itself. Angular libraries can't be left to
 * Node (`resolve.noExternal`, above), and without pre-bundling Vite linked and transformed every
 * one of them on every start, which was most of the first page's time. Discovery scans the server
 * entry, Vite's input for this environment. The bundle holds only the libraries Vite wouldn't
 * externalize: everything else they import stays an import, so Node loads one copy of rxjs for
 * the bundle and for the app. The cache lives in `node_modules/.vite/deps_ssr`, keyed by the
 * lockfile and the config, like the client's.
 */
function serverOptimizeDeps(noExternal: RegExp[]): DepOptimizationOptions {
  const bundled = (id: string) => noExternal.some((pattern) => pattern.test(id));
  const externalizer: RolldownPlugin = {
    name: 'vite-plugin-ngp:ssr-external',
    resolveId: {
      // Bare imports from inside a bundled library. Entries have no importer.
      filter: {id: /^[\w@][^:]/},
      async handler(id, importer, options) {
        if (!importer || bundled(id) || isBuiltin(id)) {
          return null;
        }
        // What Vite externalizes for the ssr environment: a bare import that resolves into
        // node_modules. A linked workspace package resolves outside and stays bundled.
        const resolved = await this.resolve(id, importer, {...options, skipSelf: true});
        return resolved && /[\\/]node_modules[\\/]/.test(resolved.id) ? {id, external: true} : null;
      },
    },
  };
  // Vite writes a hidden source map next to each chunk, and parses and combines it with every
  // transform's map on every start: about 170 ms of the playground's first page, for stack traces
  // that point into fesm2022 instead of the readable pre-bundle. Rolldown writes the maps after
  // `generateBundle`, so they're removed once written.
  const noSourcemaps: RolldownPlugin = {
    name: 'vite-plugin-ngp:ssr-no-sourcemaps',
    async writeBundle(options, bundle) {
      await Promise.all(
        Object.values(bundle).map((chunk) =>
          chunk.type === 'chunk' && chunk.sourcemapFileName && options.dir
            ? fs.promises.rm(path.join(options.dir, chunk.sourcemapFileName), {force: true})
            : undefined,
        ),
      );
    },
  };
  return {
    noDiscovery: false,
    rolldownOptions: {
      // The server environment's `define` (the `config` and `configEnvironment` hooks), baked in
      // so Vite's define transform finds nothing to replace in the pre-bundle on each start.
      transform: {define: {ngJitMode: 'false', ngI18nClosureMode: 'false', ngHmrMode: 'false', ngServerMode: 'true'}},
      plugins: [externalizer, linkerRolldownPlugin(), noSourcemaps],
    },
  };
}

/**
 * Angular's build optimizer, in `vite build` only: marks Angular's definitions and top-level code
 * pure, so Rolldown can drop what the app doesn't use. Runs after the linker for libraries, and
 * after Vite has stripped TypeScript for the app's own modules.
 */
function optimizerPlugin(): Plugin {
  return {
    name: 'vite-plugin-ngp:optimizer',
    apply: 'build',
    config() {
      // What the CLI passes to esbuild as `pure`.
      return {build: {rolldownOptions: {treeshake: {manualPureFunctions: ['forwardRef']}}}};
    },
    transform: {
      filter: {id: /\.[cm]?[jt]s$/, code: OPTIMIZER_CANDIDATE},
      handler(code, id) {
        return optimize(code, id, {sideEffectFree: isSideEffectFree(cleanId(id))}) as never;
      },
    },
  };
}

/**
 * Invalidates the stale modules, and returns them for Vite to propagate along with the modules
 * Vite picked itself. Vite's include, for a new file, every module whose import of it failed to
 * resolve before. With nothing stale, returns undefined and leaves Vite's choice alone.
 */
function invalidateAll(
  graph: EnvironmentModuleGraph,
  stale: EnvironmentModuleNode[],
  modules: EnvironmentModuleNode[],
): EnvironmentModuleNode[] | undefined {
  if (stale.length === 0) {
    return;
  }
  for (const mod of new Set(stale)) {
    graph.invalidateModule(mod);
  }
  return [...new Set([...stale, ...modules])];
}

function modulesOf(graph: EnvironmentModuleGraph, files: string[]): EnvironmentModuleNode[] {
  return files.flatMap((f) => [...(graph.getModulesByFile(f) ?? [])]);
}

function resolveTsconfig(root: string, configured: string | undefined, testing: boolean): string {
  const candidates = configured
    ? [configured]
    : [...(testing ? ['tsconfig.spec.json'] : []), 'tsconfig.app.json', 'tsconfig.json'];
  for (const candidate of candidates) {
    const file = path.resolve(root, candidate);
    if (fs.existsSync(file)) {
      return file;
    }
  }
  throw new Error(`vite-plugin-ngp: no tsconfig found in ${root} (tried ${candidates.join(', ')})`);
}

/** A module the compiler plugin transforms: the app's own TypeScript. */
function isAppModule(id: string): boolean {
  const file = cleanId(id);
  return TS_MODULE.test(file) && !/\.d\.[cm]?ts$/.test(file) && !/[\\/]node_modules[\\/]/.test(file);
}

/** Vitest sets VITEST in the process that runs Vite and in every worker. */
function isVitest(): boolean {
  return !!process.env['VITEST'];
}

function cleanId(id: string): string {
  return id.replace(/[?#].*$/, '');
}

/**
 * Reads a file that may be in the middle of a write, the way Vite reads a changed file. Saving
 * truncates the file and then writes it, and a busy thread pool can leave a gap between the two.
 * An empty read waits up to 100 ms for the write to land. Resolves to undefined if the file is gone.
 */
async function readWritten(file: string): Promise<string | undefined> {
  const content = await fs.promises.readFile(file, 'utf8').catch(() => undefined);
  if (content !== '') {
    return content;
  }
  const mtime = (await fs.promises.stat(file).catch(() => null))?.mtimeMs;
  for (let n = 0; n < 10; n++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if ((await fs.promises.stat(file).catch(() => null))?.mtimeMs !== mtime) {
      break;
    }
  }
  return fs.promises.readFile(file, 'utf8').catch(() => undefined);
}
