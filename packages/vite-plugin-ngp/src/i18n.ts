import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import type {ɵParsedTranslation} from '@angular/localize';
import remapping from '@jridgewell/remapping';
import MagicString from 'magic-string';
import type {Connect, Logger, Plugin, ResolvedConfig} from 'vite';

export interface I18nOptions {
  /**
   * The locale the app's source text is written in. Defaults to `en-US`. Built into its own folder,
   * like every other locale, with `$localize` metadata stripped and no translation applied.
   */
  sourceLocale?: string | {code: string; subPath?: string};
  /**
   * Translated locales: the locale code, and the translation file (or files) relative to Vite's
   * root. XLIFF 1.2 and 2.0, XMB/XTB, JSON and ARB are read, as with the Angular CLI. `subPath` is
   * the output folder and URL segment, and defaults to the locale code.
   */
  locales?: Record<string, string | string[] | {translation: string | string[]; subPath?: string}>;
  /** The locale the dev server serves. Defaults to the source locale. */
  devLocale?: string;
  /** What to do with a message the translation file lacks. Defaults to `warning`. */
  missingTranslation?: 'error' | 'warning' | 'ignore';
}

interface Locale {
  code: string;
  /** Output folder below each environment's outDir, and the URL segment the locale is served at. */
  subPath: string;
  /** Absolute paths of the translation files. None for the source locale. */
  files: string[];
}

type Translations = Record<string, ɵParsedTranslation>;

interface SourceMapJson {
  sources: (string | null)[];
  [key: string]: unknown;
}

/**
 * Stands in for the locale in the build's `$localize` prelude until each locale's output replaces
 * it with the locale code and its locale data. Same name the Angular CLI uses.
 */
const LOCALE_PLACEHOLDER = '___NG_LOCALE_INSERT___';
const PRELUDE_ID = 'virtual:ngp-i18n';
const RESOLVED_PRELUDE_ID = '\0' + PRELUDE_ID;

/**
 * Set by `extractMessages`: build without translating, so the output keeps every `$localize`
 * message for @angular/localize's extractor to find.
 */
export const EXTRACT_ENV = 'NGP_I18N_EXTRACT';

/**
 * The plugin's view of the i18n options, exposed as `api` so the extractor can read the source
 * locale from a resolved Vite config, and the build can find each locale's index.html.
 */
export interface I18nApi {
  sourceLocale: string;
  /** Each locale's folder below the outDir. Known once Vite's config is read. */
  folders(): string[];
}

/**
 * Angular i18n, the way the Angular CLI does it. ngp compiles `i18n` attributes into `$localize`
 * tagged templates, and this plugin decides what `$localize` means:
 *
 * - `vite` (dev): one locale, `devLocale`, translated at runtime. Each entry module first imports a
 *   prelude that loads `@angular/localize/init`, that locale's data and its translations.
 * - `vite build`: every locale, translated at build time, the way the CLI does it. Vite builds and
 *   minifies the app once. Then this plugin's `generateBundle` writes every file once per locale,
 *   into `<outDir>/<subPath>/`, with each `$localize` call replaced by its translated string. No
 *   `$localize` runtime ships.
 */
/**
 * @param ssrDeps Whether the `ssr` environment pre-bundles its dependencies in the dev server, so
 * the prelude's imports are pre-bundled there too, in the first run rather than when the first
 * render discovers them.
 */
export function i18nPlugin(options: I18nOptions, getEntries: (root: string) => string[], ssrDeps = false): Plugin {
  const source = typeof options.sourceLocale === 'object' ? options.sourceLocale : {code: options.sourceLocale ?? 'en-US'};
  let config: ResolvedConfig;
  let locales: Locale[] = [];
  let command: 'build' | 'serve' = 'serve';
  const extracting = () => process.env[EXTRACT_ENV] === '1';
  /** The URL the app is deployed under. Each locale lives at `<base><subPath>/`. */
  let deployBase = '/';
  const translations = new Map<string, Promise<Translations>>();
  /** Every locale renders the same code for a chunk, so each chunk is parsed once. */
  const scans = new Map<string, Promise<LocalizeSites>>();
  const reported = new Set<string>();

  function loadLocale(locale: Locale): Promise<Translations> {
    let loaded = translations.get(locale.code);
    loaded ??= loadTranslationFiles(locale, config.logger);
    translations.set(locale.code, loaded);
    return loaded;
  }

  const api: I18nApi = {sourceLocale: source.code, folders: () => locales.map((l) => l.subPath)};

  return {
    name: 'vite-plugin-ngp:i18n',
    api,

    config(userConfig, env) {
      command = env.command;
      deployBase = userConfig.base ?? '/';
      const root = path.resolve(userConfig.root ?? process.cwd());
      locales = [
        {code: source.code, subPath: source.subPath ?? source.code, files: []},
        ...Object.entries(options.locales ?? {}).map(([code, value]) => {
          const spec = typeof value === 'string' || Array.isArray(value) ? {translation: value} : value;
          const files = (Array.isArray(spec.translation) ? spec.translation : [spec.translation]).map((f) => path.resolve(root, f));
          return {code, subPath: spec.subPath ?? code, files};
        }),
      ];
      if (env.command === 'serve' && !env.isPreview) {
        const devLocale = devLocaleOf(options, locales);
        const deps = ['@angular/localize/init', '@angular/localize'];
        const data = localeDataModule(devLocale.code, root);
        if (data) {
          deps.push(data.id);
        }
        // The prelude isn't in any source file, so Vite's dependency scan can't see what it imports.
        return {optimizeDeps: {include: deps}, ...(ssrDeps ? {environments: {ssr: {optimizeDeps: {include: deps}}}} : {})};
      }
      if (extracting()) {
        return;
      }
      // Every locale's files sit one folder down, at `<base><subPath>/`. Relative URLs, resolved
      // against each page's <base href>, let one build serve all of them. The public directory is
      // copied into each locale's folder by generateBundle instead of once into the outDir.
      // `vite preview` serves the outDir at `/`, and the preview middleware handles `base`.
      return {base: './', build: {copyPublicDir: false}};
    },

    configResolved(resolved) {
      config = resolved;
    },

    resolveId: {
      filter: {id: new RegExp(`^${PRELUDE_ID}$`)},
      handler: () => RESOLVED_PRELUDE_ID,
    },

    load: {
      filter: {id: new RegExp(`^\0${PRELUDE_ID}$`)},
      async handler() {
        if (command === 'build') {
          // Each locale's copy swaps the placeholder for the locale and its locale data.
          // The global has to exist before Angular reads `$localize.locale`.
          return `(globalThis.$localize ??= {}).locale = ${JSON.stringify(LOCALE_PLACEHOLDER)};\n`;
        }
        const locale = devLocaleOf(options, locales);
        for (const file of locale.files) {
          this.addWatchFile(file);
        }
        const messages: Record<string, string> = {};
        for (const [id, translation] of Object.entries(await loadLocale(locale))) {
          messages[id] = targetMessage(translation);
        }
        const data = localeDataModule(locale.code, config.root);
        return [
          `import '@angular/localize/init';`,
          `import {loadTranslations} from '@angular/localize';`,
          data ? `import ${JSON.stringify(data.id)};` : '',
          locale.files.length ? `loadTranslations(${JSON.stringify(messages)});` : '',
          `$localize.locale = ${JSON.stringify(locale.code)};`,
        ].join('\n');
      },
    },

    // Entry modules import the prelude first, so `$localize` is set up before any other module
    // runs. In dev that's the runtime and the translations; in builds just the locale.
    transform: {
      filter: {id: /\.[cm]?ts$/},
      handler(code, id) {
        if (extracting() || !getEntries(config.root).includes(id.replace(/[?#].*$/, ''))) {
          return null;
        }
        const s = new MagicString(code);
        s.prepend(`import ${JSON.stringify(PRELUDE_ID)};\n`);
        return {code: s.toString(), map: s.generateMap({hires: 'boundary'})};
      },
    },

    // In dev, the page is in the dev locale's language. Builds set it per locale in generateBundle.
    transformIndexHtml(html) {
      return command === 'serve' ? localizeHtmlLang(html, devLocaleOf(options, locales).code) : html;
    },

    // Editing a translation file reloads the page with the new text.
    hotUpdate({file}) {
      const locale = devLocaleOf(options, locales);
      if (this.environment.name !== 'client' || !locale.files.includes(file)) {
        return;
      }
      translations.delete(locale.code);
      const prelude = this.environment.moduleGraph.getModuleById(RESOLVED_PRELUDE_ID);
      if (prelude) {
        this.environment.moduleGraph.invalidateModule(prelude);
      }
      this.environment.hot.send({type: 'full-reload'});
      return [];
    },

    // Every locale's copy of a chunk has the chunk's name, so its hash must change when a
    // translation does, or a browser caching `assets/` would keep the old text. As the CLI does.
    augmentChunkHash() {
      if (command !== 'build' || extracting()) {
        return;
      }
      const hash = createHash('sha256');
      for (const locale of locales) {
        for (const file of locale.files) {
          hash.update(fs.readFileSync(file));
        }
      }
      return hash.digest('hex');
    },

    closeBundle() {
      scans.clear();
    },

    // Writes the bundle once per locale. Runs last (`post`), so Vite has emitted index.html and every
    // chunk is minified: translation only replaces string literals, so minifying once is enough.
    generateBundle: {
      order: 'post',
      async handler(outputOptions, bundle) {
        if (command !== 'build' || extracting()) {
          return;
        }
        const files = Object.values(bundle);
        for (const fileName of Object.keys(bundle)) {
          delete bundle[fileName];
        }
        // Rolldown also lists each chunk's map as an asset. Each locale writes its own map instead.
        const mapFiles = new Set(files.flatMap((f) => (f.type === 'chunk' && f.map ? [mapFileNameOf(f)] : [])));
        const publicFiles = this.environment.config.consumer === 'client' ? listFiles(config.publicDir) : [];
        for (const locale of locales) {
          const translations = await loadLocale(locale);
          const localeData = readLocaleData(locale.code, config.root, config.logger);
          const emit = (fileName: string, source: string | Uint8Array) =>
            this.emitFile({type: 'asset', fileName: path.posix.join(locale.subPath, fileName), source});
          for (const file of files) {
            if (file.type === 'asset') {
              if (mapFiles.has(file.fileName)) {
                continue;
              }
              const html = file.fileName.endsWith('.html');
              // Each index.html gets its language, and a <base href> that both the relative asset
              // URLs and Angular's router resolve against.
              emit(file.fileName, html ? localizeHtml(String(file.source), locale.code, joinBase(deployBase, locale.subPath)) : file.source);
              continue;
            }
            // Rolldown has already appended the source map comment for where it would write the map.
            let code = file.code.replace(/\n?\/\/# sourceMappingURL=[^\n]*\s*$/, '');
            let map = file.map ? (JSON.parse(file.map.toString()) as SourceMapJson) : null;
            if (code.includes('$localize') || code.includes(LOCALE_PLACEHOLDER)) {
              const result = await translateChunk(code, file.fileName, locale, {
                translations,
                // The source locale has no translations: every message is "missing", on purpose.
                missingTranslation: locale.files.length ? (options.missingTranslation ?? 'warning') : 'ignore',
                localeData,
                cache: scans,
              });
              for (const {type, message} of result.diagnostics) {
                // Once per locale, though the server bundle repeats the browser's messages.
                const key = `${locale.code}\0${message}`;
                if (!reported.has(key)) {
                  reported.add(key);
                  if (type === 'error') {
                    this.error(`[${locale.code}] ${message}`);
                  }
                  this.warn(`[${locale.code}] ${message}`);
                }
              }
              code = result.code;
              if (map && result.map) {
                map = JSON.parse(remapping([result.map as never, map as never], () => null).toString()) as SourceMapJson;
              }
            }
            if (map) {
              // One folder deeper than Rolldown wrote it, so relative sources need one more `..`.
              map.sources = map.sources.map((source) =>
                source && !/^[a-z]+:|^\//i.test(source) ? path.posix.join(...locale.subPath.split('/').map(() => '..'), source) : source,
              );
              const mapFileName = mapFileNameOf(file);
              if (outputOptions.sourcemap === 'inline') {
                code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
              } else {
                if (outputOptions.sourcemap !== 'hidden') {
                  code += `\n//# sourceMappingURL=${path.posix.relative(path.posix.dirname(file.fileName), mapFileName)}`;
                }
                emit(mapFileName, JSON.stringify(map));
              }
            }
            emit(file.fileName, code);
          }
          for (const file of publicFiles) {
            emit(path.relative(config.publicDir, file).split(path.sep).join('/'), fs.readFileSync(file));
          }
        }
      },
    },

    // `vite preview` serves the outDir as it is, and its SPA fallback is the root index.html, which
    // a localized build doesn't have. Send each locale's pages to its own index.html, and `/` to the
    // locale the browser prefers.
    configurePreviewServer(server) {
      const outDir = path.resolve(config.root, config.environments['client']?.build.outDir ?? config.build.outDir);
      server.middlewares.use(previewMiddleware(locales, source.code, outDir, deployBase));
    },
  };
}

function mapFileNameOf(chunk: {fileName: string; sourcemapFileName?: string | null}): string {
  return chunk.sourcemapFileName ?? `${chunk.fileName}.map`;
}

/** Every file below a directory, or none when it doesn't exist. */
function listFiles(dir: string): string[] {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function devLocaleOf(options: I18nOptions, locales: Locale[]): Locale {
  const code = options.devLocale ?? locales[0]!.code;
  const locale = locales.find((l) => l.code === code);
  if (!locale) {
    throw new Error(`vite-plugin-ngp: devLocale '${code}' is neither the source locale nor in i18n.locales.`);
  }
  return locale;
}

/** A translation as the runtime's `loadTranslations` takes it: text with `{$name}` placeholders. */
function targetMessage(translation: ɵParsedTranslation): string {
  let text = translation.messageParts[0]!;
  for (let i = 1; i < translation.messageParts.length; i++) {
    text += `{$${translation.placeholderNames[i - 1]}}${translation.messageParts[i]}`;
  }
  return text;
}

/**
 * Reads a locale's translation files with @angular/localize's parsers, trying each format the CLI
 * accepts. Later files win over earlier ones for the same message id.
 */
async function loadTranslationFiles(locale: Locale, logger: Logger): Promise<Translations> {
  const translations: Translations = {};
  for (const file of locale.files) {
    Object.assign(translations, await parseTranslationFile(file, await fs.promises.readFile(file, 'utf8'), logger));
  }
  return translations;
}

/**
 * One translation file, in any format `ng extract-i18n` writes. A translation unit the parser
 * can't read in full, such as a `{` in a target that isn't an ICU expression, is reported as an
 * error and the build goes on with what the parser read of it, as `ng build` does. Ghostfolio's
 * Catalan file has two such units, and `ng build` builds it with the errors in its log.
 */
export async function parseTranslationFile(file: string, contents: string, logger: Logger): Promise<Translations> {
  const tools = await import('@angular/localize/tools');
  const parsers = [
    new tools.Xliff2TranslationParser(),
    new tools.Xliff1TranslationParser(),
    new tools.XtbTranslationParser(),
    new tools.SimpleJsonTranslationParser(),
    new tools.ArbTranslationParser(),
  ];
  let parsed: ReturnType<(typeof parsers)[number]['parse']> | undefined;
  for (const parser of parsers) {
    const analysis = parser.analyze(file, contents);
    if (analysis.canParse) {
      parsed = parser.parse(file, contents, analysis.hint as never);
      break;
    }
  }
  if (!parsed) {
    throw new Error(`vite-plugin-ngp: ${file} is not a translation file in a format @angular/localize reads.`);
  }
  for (const {type, message} of parsed.diagnostics.messages) {
    if (type === 'error') logger.error(`[vite-plugin-ngp] ${path.basename(file)}: ${message}`);
    else logger.warn(`[vite-plugin-ngp] ${path.basename(file)}: ${message}`);
  }
  // The parsers take a file's locale from its header; a file configured under another code is
  // probably a mistake.
  const locale = (parsed as {locale?: string}).locale;
  if (locale && !file.includes(`.${locale}.`) && !file.includes(`/${locale}/`)) {
    logger.warn(`[vite-plugin-ngp] ${path.basename(file)} says it is for locale '${locale}'.`);
  }
  return parsed.translations;
}

/**
 * Angular's global locale data for a locale, which registers it for the pipes and plural rules.
 * Falls back from `de-CH` to `de` like the CLI. `en` and `en-US` are built into @angular/core.
 */
function localeDataModule(code: string, root: string): {id: string; file: string} | null {
  const require = createRequire(path.join(root, 'package.json'));
  let tag = new Intl.Locale(code).baseName;
  while (tag && tag !== 'en' && tag !== 'en-US') {
    const id = `@angular/common/locales/global/${tag}`;
    try {
      return {id, file: require.resolve(id)};
    } catch {
      tag = tag.split('-').slice(0, -1).join('-');
    }
  }
  return null;
}

function readLocaleData(code: string, root: string, logger: Logger): string {
  const data = localeDataModule(code, root);
  if (!data) {
    if (!/^en(-US)?$/.test(new Intl.Locale(code).baseName)) {
      logger.warn(`[vite-plugin-ngp] No Angular locale data for '${code}'. Pipes will format in en-US.`);
    }
    return '';
  }
  return fs.readFileSync(data.file, 'utf8');
}

/** An ESTree node as Vite's parser returns it, with UTF-16 offsets into the code. */
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/**
 * Translates one rendered chunk for one locale: every `$localize` tagged template becomes its
 * translated string, every read of `$localize.locale` becomes the locale code, and the prelude's
 * placeholder becomes the locale code followed by the locale's data.
 *
 * The chunk is parsed with Vite's native parser and edited with MagicString, the approach the
 * CLI's inliner moved to from Babel. Messages are translated by @angular/localize's public
 * `translate`, which is what its Babel plugins call too. Most chunks are vendor code whose only
 * `$localize` is Angular reading `$localize.locale`, and Babel spent 150–400 ms on each of those.
 */
export async function translateChunk(
  code: string,
  fileName: string,
  locale: {code: string},
  options: {
    translations: Translations;
    missingTranslation: 'error' | 'warning' | 'ignore';
    localeData: string;
    /** Scans by chunk code. Every locale renders the same code for a chunk, so one scan serves all. */
    cache?: Map<string, Promise<LocalizeSites>>;
  },
): Promise<{code: string; map: unknown; diagnostics: {type: 'error' | 'warning'; message: string}[]}> {
  const tools = await import('@angular/localize/tools');
  let scan = options.cache?.get(code);
  if (!scan) {
    scan = scanChunk(code);
    options.cache?.set(code, scan);
  }
  const sites = await scan;
  const diagnostics = new tools.Diagnostics();
  for (const message of sites.errors) {
    diagnostics.error(`${fileName}: ${message}`);
  }
  const s = new MagicString(code);
  const literal = JSON.stringify(locale.code);
  for (const site of sites.messages) {
    // Sites are in post-order, so a message nested in another's substitution is already replaced
    // and the outer one copies the result.
    const expressions = site.expressions.map(([start, end]) => s.slice(start, end));
    const [parts, substitutions] = tools.translate(
      diagnostics,
      options.translations,
      site.messageParts,
      expressions.map((_, i) => i),
      options.missingTranslation,
    );
    s.overwrite(site.start, site.end, templateLiteral(parts, substitutions.map((i: number) => expressions[i]!)));
  }
  for (const [start, end] of sites.localeReads) {
    s.overwrite(start, end, literal);
  }
  for (const site of sites.placeholders) {
    s.overwrite(site.start, site.end, literal);
    if (options.localeData) {
      // Semicolons on both sides: minified statements don't always end with one.
      s.appendRight(site.statementEnd, `\n;${options.localeData}\n;`);
    }
  }
  return {
    code: s.toString(),
    map: s.hasChanged() ? s.generateMap({hires: 'boundary', source: fileName, includeContent: true}) : null,
    diagnostics: diagnostics.messages,
  };
}

/** Where a chunk uses `$localize`, found once per chunk and reused for every locale. */
export interface LocalizeSites {
  messages: {start: number; end: number; messageParts: TemplateStringsArray; expressions: [number, number][]}[];
  localeReads: [number, number][];
  placeholders: {start: number; end: number; statementEnd: number}[];
  errors: string[];
}

async function scanChunk(code: string): Promise<LocalizeSites> {
  const {parseAstAsync} = await import('vite');
  const program = (await parseAstAsync(code)) as unknown as AstNode;
  const sites: LocalizeSites = {messages: [], localeReads: [], placeholders: [], errors: []};
  walk(program, [], (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (node.type === 'TaggedTemplateExpression' && isLocalize(node['tag'])) {
      const quasi = node['quasi'] as {quasis: {value: {raw: string; cooked: string | null}}[]; expressions: AstNode[]};
      if (quasi.quasis.some((q) => q.value.cooked == null)) {
        sites.errors.push('malformed escape sequence in a $localize message.');
        return;
      }
      const messageParts = Object.assign(
        quasi.quasis.map((q) => q.value.cooked!),
        {raw: quasi.quasis.map((q) => q.value.raw)},
      ) as unknown as TemplateStringsArray;
      const expressions = quasi.expressions.map((e): [number, number] => [e.start, e.end]);
      sites.messages.push({start: node.start, end: node.end, messageParts, expressions});
    } else if (isLocaleRead(node, parent)) {
      // `typeof $localize !== "undefined" && $localize.locale` collapses to the locale too.
      const guarded = parent?.type === 'LogicalExpression' && parent['operator'] === '&&' && parent['right'] === node && isLocalizeGuard(parent['left'] as AstNode);
      const target = guarded ? parent : node;
      sites.localeReads.push([target.start, target.end]);
    } else if (isPlaceholder(node, parent)) {
      const statement = [...ancestors].reverse().find((a) => a.type.endsWith('Statement'));
      sites.placeholders.push({start: node.start, end: node.end, statementEnd: statement?.end ?? node.end});
    }
  });
  return sites;
}

function walk(node: AstNode, ancestors: AstNode[], visit: (node: AstNode, ancestors: AstNode[]) => void): void {
  ancestors.push(node);
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof (child as AstNode).type === 'string') {
          walk(child as AstNode, ancestors, visit);
        }
      }
    } else if (value && typeof value === 'object' && typeof (value as AstNode).type === 'string') {
      walk(value as AstNode, ancestors, visit);
    }
  }
  ancestors.pop();
  visit(node, ancestors);
}

/** The prelude's placeholder: a string, or the template literal a minifier turns it into. */
function isPlaceholder(node: AstNode, parent: AstNode | undefined): boolean {
  if (node.type === 'Literal') {
    return node['value'] === LOCALE_PLACEHOLDER;
  }
  if (node.type !== 'TemplateLiteral' || parent?.type === 'TaggedTemplateExpression') {
    return false;
  }
  const quasis = node['quasis'] as {value: {cooked: string | null}}[];
  return quasis.length === 1 && quasis[0]!.value.cooked === LOCALE_PLACEHOLDER;
}

/** `$localize`, by name. Like the CLI's inliner, this doesn't check that it isn't shadowed. */
function isLocalize(node: unknown): boolean {
  return (node as AstNode | undefined)?.type === 'Identifier' && (node as AstNode)['name'] === '$localize';
}

/** `$localize.locale`, except as the target of an assignment. */
function isLocaleRead(node: AstNode, parent: AstNode | undefined): boolean {
  if (node.type !== 'MemberExpression' || node['computed'] || !isLocalize(node['object'])) {
    return false;
  }
  const property = node['property'] as AstNode;
  if (property.type !== 'Identifier' || property['name'] !== 'locale') {
    return false;
  }
  return !(parent?.type === 'AssignmentExpression' && parent['left'] === node);
}

/** `typeof $localize !== "undefined"`, either way round. */
function isLocalizeGuard(node: AstNode): boolean {
  if (node.type !== 'BinaryExpression' || (node['operator'] !== '!==' && node['operator'] !== '!=')) {
    return false;
  }
  const isTypeof = (n: AstNode) => n.type === 'UnaryExpression' && n['operator'] === 'typeof' && isLocalize(n['argument']);
  const isUndefined = (n: AstNode) => n.type === 'Literal' && n['value'] === 'undefined';
  const [left, right] = [node['left'] as AstNode, node['right'] as AstNode];
  return (isTypeof(left) && isUndefined(right)) || (isUndefined(left) && isTypeof(right));
}

/** A string literal, or a template literal when the translation has substitutions. */
function templateLiteral(parts: readonly string[], substitutions: string[]): string {
  if (substitutions.length === 0) {
    return JSON.stringify(parts[0]);
  }
  const escape = (part: string) =>
    JSON.stringify(part)
      .slice(1, -1)
      .replace(/\\"|`|\$\{/g, (m) => (m === '\\"' ? '"' : '\\' + m));
  let out = '`';
  for (let i = 0; i < parts.length; i++) {
    out += escape(parts[i]!);
    if (i < substitutions.length) {
      out += '${' + substitutions[i] + '}';
    }
  }
  return out + '`';
}

function localizeHtmlLang(html: string, lang: string): string {
  return /<html\b[^>]*\blang=/i.test(html)
    ? html.replace(/(<html\b[^>]*\blang=)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${lang}"`)
    : html.replace(/<html\b/i, `<html lang="${lang}"`);
}

/** Sets `<html lang>` and `<base href>`, adding the base element when the page has none. */
export function localizeHtml(html: string, lang: string, baseHref: string): string {
  const out = localizeHtmlLang(html, lang);
  return /<base\b[^>]*>/i.test(out)
    ? out.replace(/<base\b[^>]*>/i, `<base href="${baseHref}">`)
    : out.replace(/<head\b[^>]*>/i, (head) => `${head}\n    <base href="${baseHref}">`);
}

function joinBase(base: string, subPath: string): string {
  const prefix = base.endsWith('/') ? base : base + '/';
  return subPath ? `${prefix}${subPath}/` : prefix;
}

/**
 * Page requests under `/<subPath>/` that match no file get that locale's index.html. `/` redirects
 * to the first locale the browser accepts, else the source locale. With a `base` like `/app/`,
 * requests under it are served from the outDir as if the prefix weren't there.
 */
export function previewMiddleware(locales: Locale[], sourceLocale: string, outDir: string, base = '/'): Connect.NextHandleFunction {
  const prefix = base.startsWith('/') ? base.replace(/\/+$/, '') : '';
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (prefix && (url.pathname === prefix || url.pathname.startsWith(prefix + '/'))) {
      url.pathname = url.pathname.slice(prefix.length) || '/';
      req.url = url.pathname + url.search;
    }
    const accept = req.headers.accept ?? '';
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !accept.includes('text/html')) {
      return next();
    }
    const [first] = url.pathname.split('/').filter(Boolean);
    const locale = locales.find((l) => l.subPath === first);
    if (!locale) {
      if (url.pathname !== '/') {
        return next();
      }
      const preferred = negotiateLocale(req.headers['accept-language'] ?? '', locales) ?? locales.find((l) => l.code === sourceLocale)!;
      res.statusCode = 302;
      res.setHeader('Location', joinBase(prefix || '/', preferred.subPath));
      return res.end();
    }
    const file = path.join(outDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      req.url = `/${locale.subPath}/index.html`;
    }
    next();
  };
}

/** The first locale in an Accept-Language header that matches a built locale or its language. */
export function negotiateLocale<T extends {code: string}>(header: string, locales: T[]): T | undefined {
  const wanted = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return {tag: tag!.toLowerCase(), q: q ? Number(q.slice(2)) : 1};
    })
    .filter((w) => w.tag && w.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const {tag} of wanted) {
    const match =
      locales.find((l) => l.code.toLowerCase() === tag) ??
      locales.find((l) => l.code.toLowerCase().split('-')[0] === tag.split('-')[0]);
    if (match) {
      return match;
    }
  }
  return undefined;
}
