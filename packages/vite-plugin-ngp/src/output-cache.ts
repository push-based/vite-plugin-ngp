import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Compiled output kept between runs, so `vite build` and Vitest skip ngp's code generation, the
 * linker and the build optimizer for a module whose inputs haven't changed (decision 66 in
 * docs/decisions.md). Each entry is one JSON file under `dir`, named by a hash of everything its
 * output depends on. The dev server never uses it: a restart already compiles only what the first
 * page needs, and most of its cold start is Vite's own dependency pre-bundling, which Vite caches.
 *
 * Every write goes to a temporary name and is renamed into place, because the client and server
 * environments of one build transform modules at the same time, and two builds may share the
 * directory. A read or write that fails is a miss, never an error: the cache only saves time.
 */
export class OutputCache {
  hits = 0;
  misses = 0;
  private counter = 0;

  /**
   * `scope` is what every entry depends on: the plugin's code and the versions of the Angular
   * packages that generate or link code. See `cacheScope`.
   */
  constructor(
    readonly dir: string,
    private readonly scope: string,
  ) {}

  /** The entry for `parts`: a hash over the scope and each part, as written or as JSON. */
  key(parts: readonly unknown[]): string {
    const hash = createHash('sha256').update(this.scope).update('\0');
    for (const part of parts) {
      hash.update(typeof part === 'string' ? part : (JSON.stringify(part) ?? 'undefined')).update('\0');
    }
    return hash.digest('hex');
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(this.file(key), 'utf8')) as T;
      this.hits++;
      return value;
    } catch {
      this.misses++;
      return undefined;
    }
  }

  async put(key: string, value: unknown): Promise<void> {
    const file = this.file(key);
    const tmp = `${file}.${process.pid}.${++this.counter}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(tmp, JSON.stringify(value));
      await fs.rename(tmp, file);
    } catch {
      await fs.rm(tmp, {force: true}).catch(() => {});
    }
  }

  /** `compute`'s result for `parts`: read from the cache, or computed and kept for the next run. */
  async reuse<T>(parts: readonly unknown[], compute: () => T | Promise<T>): Promise<T> {
    const key = this.key(parts);
    const hit = await this.get<{result: T}>(key);
    if (hit) {
      return hit.result;
    }
    const result = await compute();
    await this.put(key, {result});
    return result;
  }

  private file(key: string): string {
    return path.join(this.dir, key.slice(0, 2), `${key.slice(2)}.json`);
  }
}

/**
 * `value` as JSON, without what differs between runs of the same code: the ids ngp's analyzer
 * hands out in the order it meets files and symbols (`fileId`, `symbolId`), and every span, which
 * follows from the module's own code, already in the key.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, v: unknown) => (key === 'fileId' || key === 'symbolId' || /span/i.test(key) ? undefined : v)) ?? 'undefined';
}

/**
 * What identifies an ngp build: the Angular commit its `BUILD.json` names, for the build inside
 * the package, else a hash of `preprocessor/api.js`, for a `toolchain/out` made with `pnpm
 * toolchain`. The native engine isn't hashed: its analysis is in the key already, as metadata.
 */
export async function toolchainId(toolchainDir: string): Promise<string> {
  const build = (await fs
    .readFile(path.join(toolchainDir, 'BUILD.json'), 'utf8')
    .then(JSON.parse, () => null)) as {angularCommit?: string} | null;
  if (build?.angularCommit) {
    return `angular@${build.angularCommit}`;
  }
  const api = await fs.readFile(path.join(toolchainDir, 'preprocessor/api.js'));
  return `api:${createHash('sha256').update(api).digest('hex')}`;
}

/**
 * A hash of the plugin's own compiled modules. The linker and the optimizer are code in this
 * package, and so is everything that prepares a module for ngp, so any change to them has to miss.
 * The version alone wouldn't: it stays the same between releases, while the repo's own builds and
 * tests run every commit against one cache directory.
 */
function pluginId(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.js')) {
      hash.update(name).update('\0').update(readFileSync(path.join(dir, name))).update('\0');
    }
  }
  return hash.digest('hex');
}

/**
 * What every cached output depends on: this plugin's code, and the versions of `@angular/compiler`
 * (ngp generates code with it) and `@angular/compiler-cli` (the linker). Each version is resolved
 * from the app, then from the plugin.
 */
export function cacheScope(root: string): string {
  const requires = [createRequire(path.join(root, 'package.json')), createRequire(import.meta.url)];
  const version = (name: string): string => {
    for (const require of requires) {
      try {
        return (require(`${name}/package.json`) as {version: string}).version;
      } catch {
        // Not resolvable from here: try the next.
      }
    }
    return 'unknown';
  };
  return JSON.stringify({
    plugin: pluginId(),
    compiler: version('@angular/compiler'),
    compilerCli: version('@angular/compiler-cli'),
  });
}
