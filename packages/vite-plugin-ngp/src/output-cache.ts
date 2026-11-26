import {createHash, randomBytes} from 'node:crypto';
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
 * environments of one build transform modules at the same time, and with the `cache.dir` option
 * every project of a workspace may share the directory. A read or write that fails is a miss,
 * never an error: the cache only saves time.
 */
export class OutputCache {
  hits = 0;
  misses = 0;
  private counter = 0;
  /**
   * Part of every temporary name, with the process id and the counter. Two caches in one process
   * count from zero each, and two machines on one network directory can share a process id, so
   * without it two writers of one entry could pick the same temporary file.
   */
  private readonly writer = randomBytes(6).toString('hex');

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
    const tmp = `${file}.${process.pid}.${this.writer}.${++this.counter}.tmp`;
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
 * What identifies an ngp build: a hash of every `.js` file under `preprocessor/`, the code that
 * generates the output. Not the Angular commit in `BUILD.json`: a patched or locally rebuilt
 * preprocessor keeps that commit and generates other code. About 50 files and 0.6 MB, hashed once
 * per compiler. The native engine isn't hashed: its analysis is in the key already, as metadata.
 */
export async function toolchainId(toolchainDir: string): Promise<string> {
  const dir = path.join(toolchainDir, 'preprocessor');
  const files = (await fs.readdir(dir, {recursive: true})).filter((name) => name.endsWith('.js')).sort();
  const hash = createHash('sha256');
  for (const name of files) {
    // Names hashed with `/` as the separator. The order isn't portable yet: `files` is sorted
    // with the platform's own separator, so Windows can order a build differently (#50).
    hash.update(name.split(path.sep).join('/')).update('\0').update(await fs.readFile(path.join(dir, name))).update('\0');
  }
  return `preprocessor:${hash.digest('hex')}`;
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
 *
 * `linker` is the `@angular/compiler-cli` this plugin itself resolves, which is the one linker.ts
 * imports and so the one that links. In one install it's the app's. Projects that share a
 * directory (`cache.dir`) may come from installs where it isn't, and a library entry must never
 * be read by a project whose linker is another version.
 */
export function cacheScope(root: string): string {
  const fromApp = createRequire(path.join(root, 'package.json'));
  const fromPlugin = createRequire(import.meta.url);
  const version = (name: string, requires: NodeJS.Require[]): string => {
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
    compiler: version('@angular/compiler', [fromApp, fromPlugin]),
    compilerCli: version('@angular/compiler-cli', [fromApp, fromPlugin]),
    linker: version('@angular/compiler-cli', [fromPlugin]),
  });
}
