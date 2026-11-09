import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Writes a tsconfig that extends the user's and lists only the entry points, and returns its path.
 *
 * After every update, ngp's analyzer re-resolves its entry points: it reloads the tsconfig and
 * re-expands the `include` globs, walking the whole source tree. At 5,000 components that makes a
 * one-line edit cost 172 ms; with only `files` to resolve it costs about 1 ms, with identical
 * output (ng-hybrid-preprocessor-bench, spikes/edit-anatomy.mjs). The analyzer still finds every
 * other file by following imports.
 */
export async function writeEntryTsconfig(options: {
  tsconfig: string;
  entries: string[];
  outDir: string;
}): Promise<string> {
  const content = {
    extends: options.tsconfig,
    files: options.entries,
    include: [],
  };
  const json = JSON.stringify(content, null, 2) + '\n';
  // Named by its content, so two Vite processes sharing the cache directory with different
  // entries, like a dev server next to a test run, never overwrite each other's; and written
  // whole, then moved into place, so neither ever reads a half-written file. The analyzer rereads
  // it after every update.
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 8);
  const file = path.join(options.outDir, `tsconfig.entry.${hash}.json`);
  await fs.mkdir(options.outDir, {recursive: true});
  const partial = `${file}.${process.pid}.tmp`;
  await fs.writeFile(partial, json);
  await fs.rename(partial, file);
  return file;
}
