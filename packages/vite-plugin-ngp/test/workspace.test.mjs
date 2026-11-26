// `workspaceRoot` makes a module compile to the same code in every project of a workspace, so
// with `cache.dir` the projects compile it once between them (issue #61). These run the two
// projects of test/fixtures/workspace, which import one library from outside their own folders,
// as Vitest runs on one cache directory. Run `pnpm build` first; needs an ngp toolchain build.

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import * as fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {withoutLocation} from '../dist/compiler.js';
import {copyFixture, toolchain} from './fixture.mjs';

const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

/** Runs the specs of `project`, a folder under `workspace/libs`, with `options` for the plugin. */
async function runProject(workspace, project, options) {
  const root = path.join(workspace, 'libs', project);
  try {
    // Vitest's own module cache inside the copy, so it starts empty: see shared-cache.test.mjs.
    const {stdout, stderr} = await promisify(execFile)(process.execPath, [vitestBin, 'run', '--fsModuleCachePath', path.join(root, '.vitest-cache')], {
      cwd: root,
      env: {...process.env, NO_COLOR: '1', NGP_TOOLCHAIN: toolchain, NGP_OPTIONS: JSON.stringify(options)},
    });
    return {ok: true, output: stdout + stderr};
  } catch (error) {
    return {ok: false, output: `${error.stdout}${error.stderr}`};
  }
}

/** ngp's entries under `dir` whose compiled code defines the component with `selector`. */
async function compiledEntries(dir, selector) {
  const names = (await fs.readdir(dir, {recursive: true})).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(names.map(async (name) => ({file: path.join(dir, name), value: JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))})));
  return all.filter((e) => Array.isArray(e.value.result?.diagnostics) && e.value.result.code.includes(`selectors: [['${selector}']]`));
}

/**
 * Runs project `a`, marks its compiled entry for the shared badge so a worker that runs it leaves
 * a file behind, then runs project `b`. Resolves to whether `b` ran `a`'s badge, and to the badge
 * entries in the directory afterwards.
 */
async function aThenB(label, optionsFor, prepare = async () => {}) {
  const workspace = await copyFixture('workspace', label);
  const dir = path.join(workspace, 'node_modules/.cache/ngp');
  await prepare(workspace);
  const first = await runProject(workspace, 'a', optionsFor(workspace, dir));
  assert.equal(first.ok, true, first.output);
  const [badge, ...others] = await compiledEntries(dir, 'ui-badge');
  assert.ok(badge && others.length === 0, 'project a compiled the badge once');
  const ranElsewhere = path.join(dir, 'ran-badge-of-a');
  badge.value.result.code += `\nimport {writeFileSync as __ngpMark} from 'node:fs';\n__ngpMark(${JSON.stringify(ranElsewhere)}, '');\n`;
  await fs.writeFile(badge.file, JSON.stringify(badge.value));

  const second = await runProject(workspace, 'b', optionsFor(workspace, dir));
  assert.equal(second.ok, true, second.output);
  return {
    shared: await fs.access(ranElsewhere).then(() => true, () => false),
    badges: await compiledEntries(dir, 'ui-badge'),
    workspace,
  };
}

test('with workspaceRoot and one cache.dir, the second project reads the library the first one compiled', async () => {
  const {shared, badges} = await aThenB('shared', (workspace, dir) => ({cache: {dir}, workspaceRoot: workspace}));
  assert.equal(shared, true, "project b ran project a's compiled badge");
  assert.equal(badges.length, 1, 'and compiled none of its own');
  // The path ngp writes into the code is the same from either project: from the workspace root.
  assert.match(badges[0].value.result.code, /filePath: ['"]libs\/ui\/src\/badge\.ts['"]/);
});

test('workspaceRoot may be relative to Vite\'s root', async () => {
  const {shared, badges} = await aThenB('relative', (workspace, dir) => ({cache: {dir}, workspaceRoot: '../..'}));
  assert.equal(shared, true);
  assert.match(badges[0].value.result.code, /filePath: ['"]libs\/ui\/src\/badge\.ts['"]/);
});

test('without workspaceRoot each project compiles the library for itself: its code names the project', async () => {
  const {shared, badges} = await aThenB('per-project', (workspace, dir) => ({cache: {dir}}));
  assert.equal(shared, false);
  assert.equal(badges.length, 2);
});

test('projects whose template checks differ do not share: the entry holds the diagnostics', async () => {
  const {shared, badges} = await aThenB('checks', (workspace, dir) => ({cache: {dir}, workspaceRoot: workspace}), async (workspace) => {
    const tsconfig = path.join(workspace, 'libs/b/tsconfig.json');
    const config = JSON.parse(await fs.readFile(tsconfig, 'utf8'));
    config.angularCompilerOptions.strictTemplates = false;
    await fs.writeFile(tsconfig, JSON.stringify(config));
  });
  assert.equal(shared, false);
  assert.equal(badges.length, 2);
});

test('the key leaves out the options that only say where a tsconfig is', () => {
  const options = {strictTemplates: true, paths: {'@ui/*': ['libs/ui/src/*']}, configFilePath: '/w/libs/a/tsconfig.json', basePath: '/w/libs/a', genDir: '/w/libs/a', outDir: '/w/dist', rootDir: '/w/libs/a'};
  assert.deepEqual(withoutLocation(options), {strictTemplates: true, paths: {'@ui/*': ['libs/ui/src/*']}});
});

test('workspaceRoot has to be a path', async () => {
  const {ngp} = await import('../dist/index.js');
  for (const workspaceRoot of ['', ' ', 3, null]) {
    assert.throws(() => ngp({toolchain, workspaceRoot}), /workspaceRoot must be a path/, JSON.stringify(workspaceRoot));
  }
});
