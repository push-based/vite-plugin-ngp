import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {readConfiguration} from '@angular/compiler-cli';
import {hmrCandidates} from './hmr-candidates.js';
import {FileUpdateType, loadNgp, type Analyzer, type Engine, type HybridCompiler, type NgpDiagnostic} from './ngp-api.js';
import {stableJson, toolchainId, type OutputCache} from './output-cache.js';

export interface CompilerOptions {
  toolchainDir: string;
  engine: Engine;
  /** The user's tsconfig: compiler options and rootDir come from here. */
  tsconfig: string;
  /** The tsconfig the analyzer reads. See writeEntryTsconfig for why it can differ. */
  analyzerTsconfig: string;
  /** Emit component HMR code, as the CLI's dev server does. */
  enableHmr: boolean;
  /**
   * File replacements, from replaced file to replacement, as absolute paths. The analyzer reads
   * each replacement's content as the replaced file's, before it compiles anything.
   */
  fileReplacements?: Map<string, string>;
  /** Compiled output kept between runs. Builds and Vitest set it; the dev server doesn't. */
  cache?: OutputCache;
}

/** One component's HMR update: Angular's id for it, and the update module as TypeScript. */
export interface HmrUpdate {
  id: string;
  code: string;
}

/** What an edit did: the files whose output may have changed, and the content it replaced. */
export interface FileUpdate {
  stale: string[];
  /** The content the analyzer had before, or undefined if it never saw the file. */
  previous: string | undefined;
}

/** What the analyzer knows about one file, or null for a file it has nothing on. */
type FileMetadata = Awaited<ReturnType<Analyzer['getMetadataForFile']>>;

/** A component stylesheet: a `styleUrl` file, or an inline style and its size. */
export type ComponentStyle = {label: string; file: string} | {label: string; size: number};

export interface TransformResult {
  code: string;
  map: string;
  diagnostics: NgpDiagnostic[];
  /** The output came from the cache, not from ngp. */
  cached?: boolean;
}

/**
 * One long-lived ngp compiler, driven the way Vite drives a plugin: per module, from the code
 * Vite hands over, in optimize mode, without ever running the whole-program delta pass.
 */
export class NgpCompiler {
  /** What the analyzer believes each file contains, so edits are sent to it exactly once. */
  private readonly known = new Map<string, string>();
  /** When the watcher last sent each file, or reported it deleted, by `performance.now()`. */
  private readonly edited = new Map<string, number>();
  /** Analyzer updates run one at a time, in call order. */
  private updates: Promise<unknown> = Promise.resolve();
  /** Type-check blocks as last generated, null for files without one. Stale files are dropped. */
  private readonly tcbs = new Map<string, string | null>();
  /** What the analyzer reported stale for each deleted file, to re-send when the file comes back. */
  private readonly importersOfRemoved = new Map<string, string[]>();

  private constructor(
    private readonly analyzer: Analyzer,
    private readonly hybrid: HybridCompiler,
    /**
     * Generates type-check blocks only. It shares the analyzer but parses templates with
     * whitespace preserved, as ngtsc's type-check parse (`diagNodes`) does. With whitespace
     * collapsed, every span after a collapsed run points too early: `<h1>\n  {{ titel }}` puts
     * the error 2 columns before `titel`. ngp marks this TODO(parity) in parseComponentTemplate.
     */
    private readonly typeCheckHybrid: HybridCompiler,
    private readonly rootDir: string,
    private readonly replaced: ReadonlySet<string>,
    private readonly cache: OutputCache | null,
    /** What every cached output of this compiler depends on, besides the module. See cacheKey. */
    private readonly cacheIdentity: string,
  ) {}

  static async create(options: CompilerOptions): Promise<NgpCompiler> {
    const {api, binding} = await loadNgp(options.toolchainDir, options.engine);
    const ngOptions = readConfiguration(options.tsconfig).options;
    const analyzer = await api.createAnalyzer(options.analyzerTsconfig, {
      optimize: true,
      enableHmr: options.enableHmr,
      backend: options.engine,
      ...binding,
    });
    const rootDir = path.dirname(options.tsconfig);
    // No tsconfigPath: with one, ngp rewrites .ngdiag.json after every chunk.
    const hybridOptions = {
      optimize: true,
      tcbConfig: api.buildTypeCheckingConfig(ngOptions, false),
      rootDir,
      supportJitMode: ngOptions['supportJitMode'] !== false,
      enableHmr: options.enableHmr,
      // Stylesheets go through Vite's CSS pipeline instead: see styles.ts.
      externalRuntimeStyles: true,
      // The i18n options ngc reads from angularCompilerOptions. They change the message ids in the
      // `$localize` calls ngp emits, so they have to match what the translation files were made with.
      enableI18nLegacyMessageIdFormat: ngOptions['enableI18nLegacyMessageIdFormat'] as boolean | undefined,
      i18nNormalizeLineEndingsInICUs: ngOptions['i18nNormalizeLineEndingsInICUs'] as boolean | undefined,
      i18nUseExternalIds: ngOptions['i18nUseExternalIds'] as boolean | undefined,
    };
    const hybrid = new api.HybridCompiler(analyzer, hybridOptions);
    // A mistyped `extendedDiagnostics` check or category, or `extendedDiagnostics` next to
    // `strictTemplates: false`. ngc reports these and compiles nothing; ngp compiles on but turns
    // every extended diagnostic off, which would hide the lot without a word. Fail as ngc does.
    if (hybrid.optionDiagnostics.length > 0) {
      analyzer.close();
      throw new Error(hybrid.optionDiagnostics.map((d) => `NG${d.code}: ${d.messageText}`).join('\n\n'));
    }
    const typeCheckHybrid = new api.HybridCompiler(analyzer, {...hybridOptions, enableHmr: false, preserveWhitespaces: true});
    const replacements = options.fileReplacements ?? new Map<string, string>();
    // The ngp build, the engine, and every option that reaches ngp. `tcbConfig` only shapes
    // type-check blocks. The root stays in: compiled code names its stylesheets by absolute path,
    // so a cache copied to another checkout must miss.
    const cacheIdentity = options.cache
      ? JSON.stringify({
          toolchain: await toolchainId(options.toolchainDir),
          engine: options.engine,
          hybrid: {...hybridOptions, tcbConfig: undefined},
          ngOptions: stableJson(ngOptions),
        })
      : '';
    const compiler = new NgpCompiler(
      analyzer,
      hybrid,
      typeCheckHybrid,
      rootDir,
      new Set(replacements.keys()),
      options.cache ?? null,
      cacheIdentity,
    );
    // The analyzer follows imports on disk, so it would read the replaced file. Giving it the
    // replacement's content under the replaced file's path makes every file that imports it, and
    // every decorator that reads a value from it, compile against the replacement.
    for (const [file, replacement] of replacements) {
      await compiler.update(file, await fs.readFile(replacement, 'utf8'), 'watcher');
    }
    return compiler;
  }

  /**
   * Compiles one module. `readAt` is when Vite read the file, by `performance.now()`, if known.
   * Resolves to null when ngp leaves it unchanged.
   */
  async transform(file: string, code: string, readAt?: number): Promise<TransformResult | null> {
    await this.update(file, code, 'transform', readAt);
    const metadata = await this.analyzer.getMetadataForFile(file);
    const key = await this.cacheKey(file, code, metadata);
    if (key) {
      const hit = await this.cache!.get<{result: TransformResult | null}>(key);
      if (hit) {
        return hit.result && {...hit.result, cached: true};
      }
    }
    const processed = await this.hybrid.processFile(file, code, metadata ?? undefined);
    const result = processed.magicString.hasChanged()
      ? {
          code: processed.magicString.toString(),
          map: processed.magicString.generateMap({hires: 'boundary', source: file, includeContent: true}).toString(),
          diagnostics: [...(processed.diagnostics ?? []), ...(await this.missingTemplates(file, metadata))],
        }
      : null;
    if (key) {
      await this.cache!.put(key, {result});
    }
    return result;
  }

  /**
   * The cache entry for one module's output, or null when there's no cache, or a template or
   * stylesheet file is missing, which the compile has to report.
   *
   * The output is a function of: the ngp build, its options and the root (`cacheIdentity`); the module's
   * path and code as Vite hands it over; the content of its external templates and stylesheets;
   * and the analyzer's metadata for the file, which carries the selector, inputs, outputs,
   * standalone flag and host directives of every declaration its templates use, and the value of
   * every constant its decorators read. So a change to a used component's public shape misses,
   * and a comment edit in that component's file hits. The analyzer runs either way: only ngp's
   * code generation is skipped. A missing input here would serve a wrong module with no error,
   * which is why there's a test for each kind.
   */
  private async cacheKey(file: string, code: string, metadata: FileMetadata): Promise<string | null> {
    if (!this.cache) {
      return null;
    }
    const resources: string[] = [];
    for (const cls of metadata?.classes ?? []) {
      for (const url of [cls.component?.templateUrl, ...(cls.component?.styleUrls ?? [])]) {
        if (!url) {
          continue;
        }
        const content = await fs.readFile(url.resolvedPath, 'utf8').catch(() => undefined);
        if (content === undefined) {
          return null;
        }
        resources.push(url.resolvedPath, content);
      }
    }
    return this.cache.key([this.cacheIdentity, file, code, resources, stableJson(metadata)]);
  }

  /**
   * ngp compiles a component whose `templateUrl` file doesn't exist into an empty template, with
   * no diagnostic, even in a fresh compiler. ngc fails with NG2008, so report it the same way.
   */
  private async missingTemplates(file: string, metadata: FileMetadata): Promise<NgpDiagnostic[]> {
    const missing: NgpDiagnostic[] = [];
    for (const cls of metadata?.classes ?? []) {
      const templateUrl = cls.component?.templateUrl;
      if (templateUrl && !(await fs.access(templateUrl.resolvedPath).then(() => true, () => false))) {
        missing.push({
          filePath: file,
          category: 1, // ts.DiagnosticCategory.Error
          code: 2008,
          messageText: `Could not find template file '${templateUrl.url}'.`,
          span: templateUrl.stringLiteralSpan,
        });
      }
    }
    return missing;
  }

  /**
   * Sends a file's content to the analyzer if it differs from what the analyzer has, and resolves
   * to the TypeScript files whose output may have changed, and to the content it replaced. Works
   * for templates too.
   *
   * This skips HybridCompiler.updateFileContent on purpose: that runs analyzeOptimizedDelta, which
   * re-streams every file in the program after each edit. Vite re-requests what the page still
   * uses, so dropping the stale files from the cache is enough.
   *
   * From a transform, `readAt` is when Vite read the file, as for `transform`.
   */
  update(file: string, content: string, origin: 'transform' | 'watcher', readAt?: number): Promise<FileUpdate> {
    if (origin === 'watcher') {
      this.edited.set(file, performance.now());
    }
    return this.enqueue(async () => {
      // A replaced file's content comes from its replacement on disk: once at startup, then from
      // the watcher. A transform's code can be older than the last watcher edit, when Vite loaded
      // the module just before it, and sending it would undo that edit.
      if (origin === 'transform' && this.replaced.has(file)) {
        return {stale: [], previous: this.known.get(file)};
      }
      // The same race for any file: Vite read it, the watcher then sent an edit, and now this
      // transform brings the code from before the edit. Vite transforms the module again once
      // it's invalidated, so the analyzer keeps the edit, unless the code is what's on disk now.
      if (origin === 'transform' && content !== this.known.get(file) && (await this.predatesEdit(file, content, readAt))) {
        return {stale: [], previous: this.known.get(file)};
      }
      // A file we haven't seen yet: from a transform, the analyzer has read (or will read) the
      // same disk content, so compare against disk. From the watcher, disk already holds the edit,
      // so the only safe answer is that it changed.
      const unseen = !this.known.has(file);
      const previous =
        this.known.get(file) ??
        (origin === 'transform' ? await fs.readFile(file, 'utf8').catch(() => undefined) : undefined);
      this.known.set(file, content);
      if (previous === content) {
        return {stale: [], previous};
      }
      // A file the analyzer may be seeing for the first time: only the watcher reports those, since
      // at startup every file is unseen and arrives from a transform. The analyzer re-resolves
      // module specifiers and re-reads the tsconfig's file list only for a file it's told was
      // created, and updateFileContent can't tell it that — by the time the watcher reports a new
      // file it's already on disk, so the analyzer takes it for an ordinary change.
      const created = unseen && origin === 'watcher';
      const invalidated = created
        ? await this.analyzer.invalidateFiles([{filePath: file, updateType: FileUpdateType.Created}])
        : [];
      invalidated.push(...(await this.analyzer.updateFileContent([{filePath: file, content}])));
      if (created) {
        invalidated.push(...(await this.resendImporters(file)));
      }
      return {stale: this.dropStale(file, invalidated), previous};
    });
  }

  /**
   * Tells the analyzer a file was deleted, and resolves to the TypeScript files whose output may
   * have changed: for a `.ts` file its importers, for a template the component that uses it.
   *
   * update() can't say this. The analyzer keeps every file it's sent in an in-memory overlay
   * that's never dropped, so it would go on compiling against the deleted content.
   * invalidateFiles drops the overlay, and the analyzer then finds the file gone from disk.
   */
  remove(file: string): Promise<string[]> {
    this.edited.set(file, performance.now());
    return this.enqueue(async () => {
      this.known.delete(file);
      const invalidated = await this.analyzer.invalidateFiles([{filePath: file, updateType: FileUpdateType.Deleted}]);
      const importers = invalidated.map((f) => path.resolve(f)).filter((f) => f !== file);
      if (importers.length > 0) {
        this.importersOfRemoved.set(file, importers);
      }
      return this.dropStale(file, invalidated);
    });
  }

  /**
   * Re-sends, unchanged, the content of the files the analyzer reported stale when `file` was
   * deleted, and resolves to what that made stale.
   *
   * Deleting a file drops the edge from each importer to it, so when the file comes back the
   * analyzer has nothing to connect them: it reports only the file itself as stale and leaves
   * every importer analyzed as it was, failed resolution and all. Sending an importer's content
   * is the only way to ask for it to be analyzed again. The content is what the analyzer already
   * has, so this costs one analysis per importer and changes nothing else.
   */
  private async resendImporters(file: string): Promise<string[]> {
    const importers = this.importersOfRemoved.get(file);
    this.importersOfRemoved.delete(file);
    if (!importers) {
      return [];
    }
    const updates: {filePath: string; content: string}[] = [];
    for (const importer of importers) {
      const content = this.known.get(importer) ?? (await fs.readFile(importer, 'utf8').catch(() => undefined));
      if (content !== undefined) {
        updates.push({filePath: importer, content});
      }
    }
    return updates.length > 0 ? this.analyzer.updateFileContent(updates) : [];
  }

  /**
   * Whether a transform's code may be older than the watcher's last edit to the file: Vite read
   * it before the edit, or nobody said when, and it isn't what's on disk now.
   */
  private async predatesEdit(file: string, code: string, readAt: number | undefined): Promise<boolean> {
    const editedAt = this.edited.get(file);
    if (editedAt === undefined || (readAt !== undefined && readAt > editedAt)) {
      return false;
    }
    return (await fs.readFile(file, 'utf8').catch(() => undefined)) !== code;
  }

  /** Runs analyzer updates one at a time, in call order. */
  private enqueue<T>(update: () => Promise<T>): Promise<T> {
    const run = this.updates.then(update);
    this.updates = run.catch(() => {});
    return run;
  }

  /** Drops the analyzer's stale files from ngp's cache, and returns the TypeScript ones. */
  private dropStale(file: string, invalidated: string[]): string[] {
    const stale = invalidated.filter((f) => f.endsWith('.ts')).map((f) => path.resolve(f));
    for (const f of [...stale, file]) {
      this.hybrid.fileCache.delete(f);
      this.typeCheckHybrid.fileCache.delete(f);
      this.tcbs.delete(f);
    }
    return stale;
  }

  /**
   * The type-check block of each file that has one, generated only for files that changed since
   * the last call. ngp generates blocks synchronously, so this yields to the event loop between
   * files to keep transforms flowing.
   */
  async typeCheckBlocks(files: Iterable<string>): Promise<Map<string, string>> {
    await this.updates;
    const blocks = new Map<string, string>();
    for (const file of files) {
      let tcb = this.tcbs.get(file);
      if (tcb === undefined) {
        await new Promise((resolve) => setImmediate(resolve));
        tcb = this.typeCheckHybrid.getTcbForFile(file);
        this.tcbs.set(file, tcb);
      }
      if (tcb) {
        blocks.set(file, tcb);
      }
    }
    return blocks;
  }

  /** Every file the analyzer has been sent, by a transform or an edit. */
  knownFiles(): string[] {
    return [...this.known.keys()];
  }

  /** The component file for an external template, or null if no component uses it. */
  async componentForTemplate(templateFile: string): Promise<string | null> {
    const result = await this.analyzer.getTsFileForTemplate(templateFile);
    return result?.[0] ? path.resolve(result[0].tsFilePath) : null;
  }

  /**
   * Update modules for the components in `tsFile` that use `templateFile` as their external
   * template. Resolves to an empty list when no component in the file uses it.
   */
  async hmrUpdates(tsFile: string, templateFile: string): Promise<HmrUpdate[]> {
    await this.updates;
    const metadata = await this.analyzer.getMetadataForFile(tsFile);
    const classes = (metadata?.classes ?? []).filter((cls) => {
      const template = cls.component?.templateUrl?.resolvedPath;
      return template && path.resolve(template) === templateFile;
    });
    return (await this.emitUpdates(tsFile, classes.map((cls) => cls.className))) ?? [];
  }

  /**
   * Update modules for an edit to a component's `.ts` file that only changed inline `template` or
   * `styles` values: one per component whose values changed, and none when no component's did.
   * Resolves to null when the edit changed anything else, which needs a page reload. `previous`
   * is the file's content before the edit, as `update` returned it.
   */
  async inlineHmrUpdates(tsFile: string, previous: string, current: string): Promise<HmrUpdate[] | null> {
    await this.updates;
    const metadata = await this.analyzer.getMetadataForFile(tsFile);
    const components = new Set((metadata?.classes ?? []).filter((cls) => cls.component).map((cls) => cls.className));
    const changed = hmrCandidates(tsFile, previous, current, (name) => components.has(name));
    return changed && this.emitUpdates(tsFile, changed);
  }

  /** Resolves to null if ngp has no update module for one of the classes. */
  private async emitUpdates(tsFile: string, classNames: (string | undefined)[]): Promise<HmrUpdate[] | null> {
    const updates: HmrUpdate[] = [];
    for (const className of classNames) {
      const code = className && (await this.hybrid.emitHmrUpdateModule(tsFile, className));
      if (!code) {
        return null;
      }
      updates.push({id: this.componentId(tsFile, className), code});
    }
    return updates;
  }

  /** Each component's ViewEncapsulation in `tsFile`, by class name. */
  async encapsulations(tsFile: string): Promise<Map<string, number>> {
    await this.updates;
    const metadata = await this.analyzer.getMetadataForFile(tsFile);
    const result = new Map<string, number>();
    for (const cls of metadata?.classes ?? []) {
      if (cls.className && cls.component) {
        result.set(cls.className, cls.component.encapsulation ?? 0);
      }
    }
    return result;
  }

  /**
   * Each component stylesheet in `tsFile`: one per `styleUrl` file, with its path, and one per
   * inline style, with its size in bytes as written. ngp compiles inline styles itself, so they
   * reach the bundle as written. `styleUrl` files go through Vite's CSS pipeline.
   */
  async componentStyles(tsFile: string): Promise<ComponentStyle[]> {
    await this.updates;
    const metadata = await this.analyzer.getMetadataForFile(tsFile);
    const styles: ComponentStyle[] = [];
    for (const cls of metadata?.classes ?? []) {
      for (const url of cls.component?.styleUrls ?? []) {
        styles.push({label: this.relative(url.resolvedPath), file: path.resolve(url.resolvedPath)});
      }
      cls.component?.styles?.forEach((css, i) => {
        styles.push({label: `${this.relative(tsFile)} (${cls.className} inline style ${i + 1})`, size: Buffer.byteLength(css)});
      });
    }
    return styles;
  }

  private relative(file: string): string {
    return path.relative(this.rootDir, file).split(path.sep).join('/');
  }

  /**
   * Angular's HMR id for a component: `encodeURIComponent('<path>@<ClassName>')`, the same id
   * the compiled component's HMR initializer listens for. The path is relative to rootDir for a
   * file inside it and the file's own path for one outside, such as a library next to the app in
   * a monorepo: that is how ngp's `getHmrFilePath` picks it, as ngtsc does.
   */
  componentId(tsFile: string, className: string): string {
    const relative = this.relative(tsFile);
    const file = relative.startsWith('..') || path.isAbsolute(relative) ? tsFile : relative;
    return encodeURIComponent(`${file}@${className}`);
  }

  close(): void {
    this.analyzer.close();
  }
}
