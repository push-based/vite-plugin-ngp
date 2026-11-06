// The toolchains, each as its documented default setup. Every one runs from bench/node_modules
// with the same Angular (22.3.0-next.4) and, for the Vite-based ones, the same Vite (8.3.4).
// A real app (lib/apps.mjs, kind 'real') brings its own CLI in its own node_modules, as a tool
// its pin describes, and gets vite-plugin-ngp through a link into its node_modules.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {BENCH} from './apps.mjs';

const NM = path.join(BENCH, 'node_modules');
const NG = path.join(NM, '@angular/cli/bin/ng.js');
const VITE = path.join(NM, 'vite/bin/vite.js');

/**
 * Vite configs, written into each generated app as vite.config.<tool>.mjs. Each one is the
 * plugin's README setup and nothing else, plus a per-tool cache and output directory so the tools
 * never share a dependency cache or overwrite each other's builds. A real app has a hand-written
 * vite.config.ngp.mjs in bench/real/<name>/ instead, because it needs its CLI's build options
 * carried over.
 */
export const VITE_CONFIGS = {
  ngp: `import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

// vite-plugin-ngp's documented setup. The toolchain comes from NGP_TOOLCHAIN.
export default defineConfig({
  cacheDir: 'node_modules/.vite-ngp',
  build: {outDir: 'dist-ngp'},
  plugins: [ngp()],
});
`,
  // Not a default: ngp with its type-check off, to compare with tools that don't type-check.
  'ngp-notc': `import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

// vite-plugin-ngp's documented setup with typeCheck: false.
export default defineConfig({
  cacheDir: 'node_modules/.vite-ngp-notc',
  build: {outDir: 'dist-ngp-notc'},
  plugins: [ngp({typeCheck: false})],
});
`,
  // Not a default: ngp checking with tsrs instead of tsgo, to compare the two checkers.
  'ngp-tsrs': `import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

// vite-plugin-ngp's documented setup with typeChecker: 'tsrs', which the bench installs next to it.
export default defineConfig({
  cacheDir: 'node_modules/.vite-ngp-tsrs',
  build: {outDir: 'dist-ngp-tsrs'},
  plugins: [ngp({typeChecker: 'tsrs'})],
});
`,
  analog: `import {defineConfig} from 'vite';
import angular from '@analogjs/vite-plugin-angular';

// @analogjs/vite-plugin-angular's README setup: the default (full ngtsc) path, not fastCompile.
export default defineConfig({
  cacheDir: 'node_modules/.vite-analog',
  build: {outDir: 'dist-analog'},
  resolve: {mainFields: ['module']},
  plugins: [angular()],
});
`,
  // Not a default: Analog's component HMR is opt-in. Measured only to show what turning it on buys.
  'analog-hmr': `import {defineConfig} from 'vite';
import angular from '@analogjs/vite-plugin-angular';

// Analog's README setup plus liveReload: true, its opt-in component HMR.
export default defineConfig({
  cacheDir: 'node_modules/.vite-analog-hmr',
  build: {outDir: 'dist-analog-hmr'},
  resolve: {mainFields: ['module']},
  plugins: [angular({liveReload: true})],
});
`,
  oxc: `import {defineConfig} from 'vite';
import {angular} from '@oxc-angular/vite';

// @oxc-angular/vite's README setup.
export default defineConfig({
  cacheDir: 'node_modules/.vite-oxc',
  build: {outDir: 'dist-oxc'},
  plugins: [angular()],
});
`,
};

function viteTool(id, label, pkg) {
  return {
    id,
    label,
    pkg,
    dev: (app, port) => ({
      cmd: process.execPath,
      args: [VITE, '--config', `vite.config.${id}.mjs`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    }),
    build: () => ({cmd: process.execPath, args: [VITE, 'build', '--config', `vite.config.${id}.mjs`]}),
    outDir: (app) => path.join(app.dir, app.kind === 'real' && id === 'ngp' ? app.ngp.outDir : `dist-${id}`),
    caches: (app) => (app.kind === 'real' && id === 'ngp' ? app.ngp.caches : [`node_modules/.vite-${id}`]).map((c) => path.join(app.dir, c)),
  };
}

export const TOOLS = {
  ngp: viteTool('ngp', 'vite-plugin-ngp', '@push-based/vite-plugin-ngp'),
  cli: {
    id: 'cli',
    label: 'Angular CLI',
    pkg: '@angular/build',
    // `ng serve` and `ng build` as `ng new` configures them: development for serve, production
    // for build, the CLI's persistent cache on. A real app's pin says how it runs its own CLI.
    dev: (app, port) =>
      app.kind === 'real' ? ownCommand(app, app.ownTool.dev, port) : {cmd: process.execPath, args: [NG, 'serve', '--host', '127.0.0.1', '--port', String(port)]},
    build: (app) => (app.kind === 'real' ? ownCommand(app, app.ownTool.build) : {cmd: process.execPath, args: [NG, 'build']}),
    outDir: (app) => path.join(app.dir, app.kind === 'real' ? app.ownTool.outDir : path.join('dist', projectName(app), 'browser')),
    caches: (app) => (app.kind === 'real' ? app.ownTool.caches : ['.angular']).map((c) => path.join(app.dir, c)),
  },
  // Nx, for a real app built with it. Nothing generated runs under Nx.
  nx: {
    id: 'nx',
    label: 'Nx',
    pkg: 'nx',
    dev: (app, port) => ownCommand(app, app.ownTool.dev, port),
    build: (app) => ownCommand(app, app.ownTool.build),
    outDir: (app) => path.join(app.dir, app.ownTool.outDir),
    caches: (app) => app.ownTool.caches.map((c) => path.join(app.dir, c)),
  },
  analog: viteTool('analog', 'Analog', '@analogjs/vite-plugin-angular'),
  oxc: viteTool('oxc', '@oxc-angular/vite', '@oxc-angular/vite'),
  'ngp-notc': viteTool('ngp-notc', 'vite-plugin-ngp, typeCheck off', '@push-based/vite-plugin-ngp'),
  'ngp-tsrs': viteTool('ngp-tsrs', 'vite-plugin-ngp, typeChecker tsrs', '@push-based/vite-plugin-ngp'),
  'analog-hmr': viteTool('analog-hmr', 'Analog, liveReload on', '@analogjs/vite-plugin-angular'),
};

/** A real app's own CLI command from its pin: a script path relative to the app, run with this Node. */
function ownCommand(app, argv, port) {
  const [script, ...rest] = argv.map((a) => a.replace('{port}', String(port)));
  return {cmd: process.execPath, args: [path.join(app.dir, script), ...rest], env: app.ownTool.env ?? {}};
}

function projectName(app) {
  const ng = JSON.parse(fs.readFileSync(path.join(app.dir, 'angular.json'), 'utf8'));
  return Object.keys(ng.projects)[0];
}
