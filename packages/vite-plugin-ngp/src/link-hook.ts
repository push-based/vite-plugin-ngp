import {registerHooks, createRequire} from 'node:module';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LINKER_MARKER, linkerKey, NEVER_LINKED, withoutSourceMapComment} from './linker-filter.js';
import {OutputCache} from './output-cache.js';

/**
 * Links Angular libraries as Node loads them, in a Vitest worker (`test.externalLibraries`).
 *
 * By default the plugin has Vitest inline every Angular library, so each goes through Vite, where
 * the linker runs, and then through Vitest's own transform for its module runner. Vitest keeps
 * that result per project, so in a workspace every project pays for every library again, and no
 * cache of the plugin's can serve it. Here the libraries stay external instead: Node loads them
 * itself, and this hook swaps a partially compiled module's source for its linked code on the
 * way in. Vitest never sees them. The linked code comes from the plugin's output cache, under the
 * key the linker transform uses, so the projects of a workspace that share `cache.dir` link each
 * library once between them.
 *
 * A setup file the plugin writes calls `register`, before any other setup file can import
 * Angular. `module.registerHooks` runs in the thread that calls it, for `import` and `require`
 * alike, which is where Vitest's module runner imports external modules.
 */
export interface LinkHookOptions {
  /** The output cache's directory, or null with `cache: false`: every worker then links for itself. */
  dir: string | null;
  /** The cache's scope, as the plugin computed it. See `cacheScope`. */
  scope: string;
  /** Link for JIT, and set `ngJitMode`, as `test.jitCompat` does for inlined libraries. */
  jit: boolean;
}

/** The marker as bytes: Node hands a module's source over as a buffer. */
const MARKER = Buffer.from(LINKER_MARKER);

interface State {
  options: LinkHookOptions;
  cache: OutputCache | null;
  link?: (code: string, id: string, jit: boolean) => {code: string} | null;
  /** The linker is being loaded: its own modules come through the hook and must pass untouched. */
  loadingLinker?: boolean;
}

/** On `globalThis`, so a second copy of this module in the same thread finds the first one's hook. */
const STATE = Symbol.for('vite-plugin-ngp.link-hook');
const holder = globalThis as {[STATE]?: State; ngJitMode?: boolean; ngServerMode?: boolean};

export function register(options: LinkHookOptions): void {
  const registered = holder[STATE] !== undefined;
  holder[STATE] = {options, cache: options.dir === null ? null : new OutputCache(options.dir, options.scope)};
  // What the plugin defines for code that goes through Vite, as globals for code that doesn't.
  // Angular reads both with `typeof`, so a global does at runtime what the define does at compile
  // time. `ngServerMode` is true where there's no DOM yet: Vitest's node environment, where the
  // plugin defines it true as well. Under jsdom it stays unset, as it does for inlined libraries.
  holder.ngJitMode = options.jit;
  if (typeof (globalThis as {document?: unknown}).document === 'undefined') {
    holder.ngServerMode = true;
  }
  if (registered) {
    return;
  }
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      const state = holder[STATE]!;
      // @angular/compiler-cli names every ɵɵngDeclare function, so it carries the marker too.
      if (state.loadingLinker || loaded.format !== 'module' || loaded.source == null || !url.startsWith('file:')) {
        return loaded;
      }
      const source = loaded.source;
      // A view on the same memory: this runs for every module Node loads, and most have no marker.
      const bytes =
        typeof source === 'string'
          ? null
          : ArrayBuffer.isView(source)
            ? Buffer.from(source.buffer, source.byteOffset, source.byteLength)
            : Buffer.from(source as ArrayBuffer);
      if (bytes ? !bytes.includes(MARKER) : !(source as string).includes(LINKER_MARKER)) {
        return loaded;
      }
      // The path as Vite writes it, so the entry is the one the linker transform reads and writes.
      const file = fileURLToPath(url).split(path.sep).join('/');
      if (NEVER_LINKED.test(file)) {
        return loaded;
      }
      const input = withoutSourceMapComment(bytes ? bytes.toString('utf8') : (source as string));
      const run = () => {
        // Loaded on the first miss only: it brings in @angular/compiler-cli and Vite's parser.
        if (!state.link) {
          state.loadingLinker = true;
          try {
            state.link = (createRequire(import.meta.url)('./linker.js') as {link: NonNullable<State['link']>}).link;
          } finally {
            state.loadingLinker = false;
          }
        }
        return state.link(input, file, state.options.jit);
      };
      const parts = linkerKey(file, input, state.options.jit);
      const linked = state.cache ? state.cache.reuseSync(parts, run) : run();
      return linked ? {...loaded, source: linked.code} : loaded;
    },
  });
}
