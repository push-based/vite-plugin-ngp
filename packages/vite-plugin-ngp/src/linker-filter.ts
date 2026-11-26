/**
 * How to tell a module that needs linking, kept apart from linker.ts so the hook that links
 * libraries as Node loads them (link-hook.ts) can ask without loading @angular/compiler-cli.
 */

/** Every partially compiled declaration is a call to a function with this prefix. */
export const LINKER_MARKER = 'ɵɵngDeclare';

/** Angular's compiler and core define the ɵɵngDeclare functions but never need linking. */
export const NEVER_LINKED = /[\\/]@angular[\\/](?:compiler|core)[\\/]/;

/**
 * `code` with the source map comment that ends it blanked out, which is how Vite hands a module
 * to a transform once it has read the map. Node hands the file over as it is. Both ways of
 * linking a library start from this text, so they agree on the cache entry and on what's in it.
 * Only a comment at the very end counts: nothing else can end a module with that text.
 */
export function withoutSourceMapComment(code: string): string {
  return code.replace(/\/\/[#@] ?sourceMappingURL=[^\s'"`]+(\s*)$/, (comment: string, space: string) => ' '.repeat(comment.length - space.length) + space);
}

/** The output cache's key for a linked module. `file` is its path with `/` as the separator. */
export function linkerKey(file: string, input: string, jit: boolean): string[] {
  // Without JIT the key is the one it always was.
  return jit ? ['linker', file, input, 'jit'] : ['linker', file, input];
}
