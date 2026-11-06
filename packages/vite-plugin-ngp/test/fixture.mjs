// Helpers for tests that build or serve a fixture app with Vite. Each test file works on its own
// copy of the fixture, so test files can run in parallel and edit files without touching the repo.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBuilder, createLogger} from 'vite';
import {ngp} from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
export const toolchain = process.env.NGP_TOOLCHAIN ?? path.join(repo, 'toolchain/out');

/**
 * Copies `test/fixtures/<name>` to a fresh directory in `test/.tmp` and resolves to its path. The
 * copy stays inside the repo, so it resolves @angular/* from the repo's node_modules the way the
 * original would, and outside any node_modules, which the plugin doesn't compile.
 */
export async function copyFixture(name, label) {
  const dir = path.join(here, '.tmp', `${name}-${label}`);
  await fs.rm(dir, {recursive: true, force: true});
  await fs.cp(path.join(here, 'fixtures', name), dir, {recursive: true});
  return dir;
}

/** A Vite logger that keeps every warning and error instead of printing it. */
export function recordingLogger() {
  const logger = createLogger('warn', {allowClearScreen: false});
  const messages = {warnings: [], errors: []};
  logger.warn = (msg) => messages.warnings.push(msg);
  logger.warnOnce = (msg) => messages.warnings.push(msg);
  logger.error = (msg) => messages.errors.push(msg);
  return {logger, messages};
}

/**
 * Runs `vite build` on `root` with the plugin and `options`. `without` names plugins to leave out,
 * to show what goes wrong without them.
 */
export async function build(root, options, {without = [], logger} = {}) {
  const plugins = ngp({toolchain, ...options}).filter((p) => !without.includes(p.name));
  // Its own cache: without it Vite falls back to the repo root's node_modules/.vite, which
  // every parallel test file would then share, including the type-check tsconfig written there.
  const cacheDir = path.join(root, '.vite');
  const builder = await createBuilder({root, cacheDir, configFile: false, logLevel: 'silent', customLogger: logger, plugins});
  await builder.buildApp();
}

/** Every file under `dir`, as `{name, content}`, with names relative to `dir`. */
export async function readOutput(dir) {
  const names = (await fs.readdir(dir, {recursive: true})).filter((f) => /\.(js|css|html)$/.test(f));
  return Promise.all(names.map(async (name) => ({name, content: await fs.readFile(path.join(dir, name), 'utf8')})));
}
