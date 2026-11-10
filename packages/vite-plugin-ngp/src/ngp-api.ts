// The slice of ngp's API this plugin uses, typed by hand. ngp isn't published, so there's no
// package to take types from; these match `toolchain/out/preprocessor/api.js` at Angular b355f62.

import {existsSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export type Engine = 'native' | 'wasm';

export interface MagicStringLike {
  toString(): string;
  hasChanged(): boolean;
  generateMap(options: {hires?: boolean | 'boundary'; source?: string; includeContent?: boolean}): {
    toString(): string;
  };
}

export interface NgpDiagnostic {
  filePath?: string;
  category: number;
  code: number;
  messageText: string;
  span?: {start: number; end: number};
}

export interface ProcessedFile {
  magicString: MagicStringLike;
  diagnostics?: NgpDiagnostic[];
}

/** ngp's `FileUpdateType` enum, which crosses into Rust as a number. */
export const FileUpdateType = {Created: 0, Deleted: 1, Changed: 2} as const;
export type FileUpdateType = (typeof FileUpdateType)[keyof typeof FileUpdateType];

export interface ClassMetadata {
  className?: string;
  component?: {
    templateUrl?: {url: string; resolvedPath: string; stringLiteralSpan?: {start: number; end: number}};
    /** ViewEncapsulation as its numeric value. Absent means Emulated. */
    encapsulation?: number;
    /** Inline `styles`, as written. */
    styles?: string[];
    styleUrls?: {url: string; resolvedPath: string}[];
  };
}

export interface Analyzer {
  getMetadataForFile(filePath: string): Promise<{filePath: string; classes: ClassMetadata[]} | null>;
  /** Tells the analyzer a file changed. Resolves to every file whose analysis is now stale. */
  updateFileContent(updates: {filePath: string; content: string}[]): Promise<string[]>;
  /**
   * Drops each file from the analyzer's in-memory overlay, so it reads the file from disk again (or
   * finds it gone). Resolves to every TypeScript file whose analysis is now stale. Since
   * 22.3.0-next.3 `updateType` matters: `Created` and `Deleted` also make the analyzer resolve
   * module specifiers and read the tsconfig's file list again, which `Changed` doesn't.
   */
  invalidateFiles(updates: {filePath: string; updateType: FileUpdateType}[]): Promise<string[]>;
  getTsFileForTemplate(templatePath: string): Promise<{tsFilePath: string}[] | null>;
  close(): void;
}

export interface HybridCompiler {
  readonly analyzer: Analyzer;
  /** Per-file analysis cache, keyed by the analyzer's file path. */
  readonly fileCache: Map<string, unknown>;
  /** `metadata` is the analyzer's result for the file, if already fetched; ngp looks it up otherwise. */
  processFile(filePath: string, content: string, metadata?: NonNullable<Awaited<ReturnType<Analyzer['getMetadataForFile']>>>): Promise<ProcessedFile>;
  /** The update module for one component, as TypeScript, or null if HMR is off. */
  emitHmrUpdateModule(filePath: string, className: string): Promise<string | null>;
  /**
   * The file's type-check block (what the CLI writes as `.ngtypecheck.ts`), or null if the file
   * has no components or directives to check. Cached in `fileCache`. Optimize mode only.
   */
  getTcbForFile(filePath: string): string | null;
  /**
   * What's wrong with the tsconfig's `angularCompilerOptions`, found when the compiler is built
   * and never part of `processFile`'s diagnostics: an `extendedDiagnostics` check or category
   * that doesn't exist, or `extendedDiagnostics` next to `strictTemplates: false`. With any of
   * these ngp keeps compiling but runs no extended diagnostic at all, where ngtsc stops.
   */
  readonly optionDiagnostics: readonly {code: number; category: number; messageText: string}[];
}

export interface HybridCompilerOptions {
  optimize: boolean;
  tcbConfig: unknown;
  rootDir: string;
  supportJitMode: boolean;
  enableHmr: boolean;
  /** Keep whitespace in templates. A component's own `preserveWhitespaces` wins. */
  preserveWhitespaces?: boolean;
  /**
   * Leave `styleUrl` files out of the component and emit `ɵɵExternalStylesFeature([paths])`, for
   * the runtime to load them. Inline styles are compiled in either way.
   */
  externalRuntimeStyles: boolean;
  /** Add legacy message ids (`␟<id>`) to each `$localize` message. ngp defaults to true, like ngc. */
  enableI18nLegacyMessageIdFormat?: boolean;
  i18nNormalizeLineEndingsInICUs?: boolean;
  /** Closure Compiler message names only (`MSG_EXTERNAL_<id>`); no effect on `$localize`. */
  i18nUseExternalIds?: boolean;
}

export interface NgpApi {
  createAnalyzer(
    tsconfigPath: string,
    options: {optimize: boolean; enableHmr: boolean; backend: Engine; nativeBinding?: string; wasmBinding?: string},
  ): Promise<Analyzer>;
  HybridCompiler: new (analyzer: Analyzer, options: HybridCompilerOptions) => HybridCompiler;
  buildTypeCheckingConfig(ngOptions: unknown, enableTemplateTypeChecker: boolean): unknown;
}

/**
 * The ngp build inside the published package, which toolchain/bundle.mjs assembles before a
 * release. A clone of the repo has none: there, `toolchain` or NGP_TOOLCHAIN points at
 * toolchain/out.
 */
export const BUNDLED_TOOLCHAIN = fileURLToPath(new URL('../ngp/', import.meta.url));

/** The platforms the published package carries a native engine for, as `<platform>-<arch>`. */
export const NATIVE_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

/** The toolchain to load: the option, then NGP_TOOLCHAIN, then the bundled build if there is one. */
export function resolveToolchain(option: string | undefined, env = process.env): string {
  const dir = option ?? env['NGP_TOOLCHAIN'] ?? (existsSync(BUNDLED_TOOLCHAIN) ? BUNDLED_TOOLCHAIN : undefined);
  if (!dir) {
    throw new Error(
      'vite-plugin-ngp: no ngp build found. This copy of the plugin has none bundled, so set the ' +
        '`toolchain` option or NGP_TOOLCHAIN to an ngp build, such as the repo\'s toolchain/out.',
    );
  }
  return dir;
}

/**
 * The native engine for this machine. The published package keeps one per platform under
 * `engines/native/<platform>-<arch>/`; `pnpm toolchain` writes the host's to `engines/native/`.
 * The per-platform builds link against glibc, so they're skipped on musl (Alpine).
 */
export function nativeBindingPath(toolchainDir: string, platform = `${process.platform}-${process.arch}`, musl = isMusl()) {
  const perPlatform = path.join(toolchainDir, 'engines/native', platform, 'ng_analyze.node');
  if (!musl && existsSync(perPlatform)) return perPlatform;
  const host = path.join(toolchainDir, 'engines/native/ng_analyze.node');
  if (existsSync(host)) return host;
  throw new Error(
    `vite-plugin-ngp: ${toolchainDir} has no native ngp engine for ${platform}${musl ? ' (musl)' : ''}. ` +
      `Set \`engine: 'wasm'\`, which runs anywhere but analyzes up to twice as slowly, or build ngp ` +
      `on this machine with \`pnpm toolchain\` in the vite-plugin-ngp repo.`,
  );
}

function isMusl() {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined;
  return !report?.header?.glibcVersionRuntime;
}

/**
 * Loads ngp from a toolchain directory: `preprocessor/api.js` and `engines/{native,wasm}/`, as
 * `pnpm toolchain` lays out toolchain/out and toolchain/bundle.mjs lays out the bundled build.
 */
export async function loadNgp(toolchainDir: string, engine: Engine) {
  const apiPath = path.join(toolchainDir, 'preprocessor/api.js');
  const binding =
    engine === 'native'
      ? {nativeBinding: nativeBindingPath(toolchainDir)}
      : {wasmBinding: path.join(toolchainDir, 'engines/wasm/ng_analyze.js')};
  for (const file of [apiPath, ...Object.values(binding)]) {
    await fs.access(file).catch(() => {
      throw new Error(
        `vite-plugin-ngp: ${file} not found. Build ngp with \`pnpm toolchain\` in the ` +
          `vite-plugin-ngp repo root, then point the plugin's \`toolchain\` option or ` +
          `NGP_TOOLCHAIN at its toolchain/out directory.`,
      );
    });
  }
  const api = (await import(pathToFileURL(apiPath).href)) as NgpApi;
  return {api, binding};
}
