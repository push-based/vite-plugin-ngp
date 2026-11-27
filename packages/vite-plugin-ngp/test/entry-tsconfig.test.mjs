// The analyzer reads a generated tsconfig that lists only the entry points (decision 4 in
// docs/decisions.md). This checks that every playground module compiles to the same output with
// it as with the app's own tsconfig. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {NgpCompiler} from '../dist/compiler.js';
import {writeEntryTsconfig} from '../dist/entry-tsconfig.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const playground = path.join(repo, 'playground');
const toolchainDir = process.env.NGP_TOOLCHAIN ?? path.join(repo, 'toolchain/out');

async function compileAll(analyzerTsconfig, files) {
  const tsconfig = path.join(playground, 'tsconfig.app.json');
  const compiler = await NgpCompiler.create({toolchainDir, engine: 'native', tsconfig, analyzerTsconfig, enableHmr: false});
  const out = new Map();
  try {
    for (const file of files) {
      const result = await compiler.transform(file, await fs.readFile(file, 'utf8'));
      out.set(file, result?.code ?? null);
    }
  } finally {
    compiler.close();
  }
  return out;
}

test('entry-only tsconfig compiles every playground module identically', async () => {
  const files = (await fs.readdir(path.join(playground, 'src'), {recursive: true}))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(playground, 'src', f))
    .sort();
  const entryTsconfig = await writeEntryTsconfig({
    tsconfig: path.join(playground, 'tsconfig.app.json'),
    entries: [path.join(playground, 'src/main.ts')],
    outDir: await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-ngp-')),
  });

  const full = await compileAll(path.join(playground, 'tsconfig.app.json'), files);
  const entryOnly = await compileAll(entryTsconfig, files);

  for (const file of files) {
    if ((await fs.readFile(file, 'utf8')).includes('@Component(')) {
      assert.ok(full.get(file), `expected ngp to compile ${path.relative(playground, file)}`);
    }
  }
  for (const file of files) {
    assert.equal(entryOnly.get(file), full.get(file), path.relative(playground, file));
  }
});

// Under Vitest the analyzer starts with no entries and reads each file when it's first compiled
// (decision 24). The output has to match a full build anyway, specs included.
test('an analyzer with no entries compiles every playground module identically', async () => {
  const files = (await fs.readdir(path.join(playground, 'src'), {recursive: true}))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(playground, 'src', f))
    .sort();
  const noEntries = await writeEntryTsconfig({
    tsconfig: path.join(playground, 'tsconfig.spec.json'),
    entries: [],
    outDir: await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-ngp-')),
  });

  const full = await compileAll(path.join(playground, 'tsconfig.spec.json'), files);
  const onDemand = await compileAll(noEntries, files);

  assert.ok(full.get(path.join(playground, 'src/app/pages/components/rating.spec.ts')), 'expected ngp to compile the spec host component');
  for (const file of files) {
    assert.equal(onDemand.get(file), full.get(file), path.relative(playground, file));
  }
});

// In a dev server that renders pages, the browser's and the server's compiler are created
// together and write the same file.
test('two writers of the same tsconfig at once both get it', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-ngp-'));
  const options = {tsconfig: path.join(playground, 'tsconfig.app.json'), entries: [path.join(playground, 'src/main.ts')], outDir};
  const files = await Promise.all(Array.from({length: 8}, () => writeEntryTsconfig(options)));
  assert.equal(new Set(files).size, 1, 'one file, named by its content');
  assert.deepEqual(JSON.parse(await fs.readFile(files[0], 'utf8')).files, options.entries);
  assert.deepEqual(await fs.readdir(outDir), [path.basename(files[0])], 'no partial file is left behind');
});
