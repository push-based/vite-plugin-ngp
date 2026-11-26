// Scaffolds each template, installs it with the plugin packed from this repo, and checks that the
// app builds, passes its spec and serves pages, first as a plain Vite project, then migrated to
// Vite+ when `vp` is on PATH. The rewrite `vp migrate` makes is the one `vp create` makes after a
// template exits, so this is what `vp create @push-based/ngp` produces, minus the download.
//
// Needs the network for the install, and an ngp build: NGP_TOOLCHAIN, or the bundle that
// `node toolchain/bundle.mjs --host-only` puts in the plugin, or the repo's toolchain/out.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';

const repo = join(import.meta.dirname, '..', '..', '..');
const pluginDir = join(repo, 'packages', 'vite-plugin-ngp');
const CLI = join(import.meta.dirname, '..', 'index.js');
const work = mkdtempSync(join(tmpdir(), 'create-ngp-apps-'));

const toolchain =
  process.env.NGP_TOOLCHAIN ??
  (existsSync(join(pluginDir, 'ngp')) ? undefined : existsSync(join(repo, 'toolchain', 'out')) ? join(repo, 'toolchain', 'out') : undefined);
const env = {...process.env, ...(toolchain ? {NGP_TOOLCHAIN: toolchain} : {}), CI: 'true'};
const noNgp = !toolchain && !existsSync(join(pluginDir, 'ngp')) && 'no ngp build: run `pnpm toolchain`, or set NGP_TOOLCHAIN';
const hasVp = spawnSync('vp', ['--version'], {encoding: 'utf8'}).status === 0;

/** Runs a command to completion and fails the test with its output if it fails. */
function sh(cwd, command, args) {
  const result = spawnSync(command, args, {cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

let tarball = '';

/** Scaffolds `template` into `name` and points it at the packed plugin. */
function scaffoldApp(name, template) {
  sh(work, process.execPath, [CLI, name, '--no-interactive', '--template', template]);
  const dir = join(work, name);
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.devDependencies['@push-based/vite-plugin-ngp'] = `file:${tarball}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return dir;
}

/** Starts a server, waits until `path` answers, returns the body and stops the server. */
async function fetchFrom(cwd, command, args, port, path, headers = {}) {
  // Its own process group, so stopping it also stops what it started: `vp dev` and `pnpm exec`
  // run Vite in a child process.
  const child = spawn(command, args, {cwd, env: {...env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const response = await fetch(`http://localhost:${port}${path}`, {headers});
        if (response.ok) {
          return await response.text();
        }
      } catch {
        // Not listening yet.
      }
      if (child.exitCode !== null) {
        break;
      }
      await delay(250);
    }
    assert.fail(`${command} ${args.join(' ')} never answered ${path}:\n${output}`);
  } finally {
    try {
      process.kill(-(child.pid ?? 0));
    } catch {
      // Already gone.
    }
  }
}

const html = {Accept: 'text/html'};

/**
 * Plants a template error, builds, and checks the build fails with TypeScript's message at the
 * template. A plugin that loads the wrong TypeScript throws instead (pnpm 11 and later, under Vite+).
 */
function assertTemplateErrorFailsBuild(dir, command, args) {
  const file = join(dir, 'src', 'app', 'app.html');
  const template = readFileSync(file, 'utf8');
  writeFileSync(file, template.replace('clicks()', 'clickz()'));
  try {
    const result = spawnSync(command, args, {cwd: dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, `the build passed with a template error:\n${output}`);
    assert.match(output, /app\.html:\d+:\d+ - error TS2551: Property 'clickz' does not exist on type 'App'/);
  } finally {
    writeFileSync(file, template);
  }
}

describe('scaffolded apps', {skip: noNgp}, () => {
  before(() => {
    // The plugin as npm would ship it, minus the four-engine check its prepack makes.
    sh(pluginDir, 'pnpm', ['pack', '--pack-destination', work, '--config.ignore-scripts=true']);
    tarball = join(work, readdirSync(work).find((f) => f.endsWith('.tgz')) ?? '');
  });

  describe('with Vite', () => {
    it('app: installs, builds, passes its spec, and serves compiled components', async () => {
      const dir = scaffoldApp('vite-app', 'app');
      sh(dir, 'pnpm', ['install']);
      assertTemplateErrorFailsBuild(dir, 'pnpm', ['run', 'build']);
      sh(dir, 'pnpm', ['run', 'build']);
      assert.ok(existsSync(join(dir, 'dist', 'index.html')));
      assert.match(sh(dir, 'pnpm', ['test']), /1 passed/);
      const app = await fetchFrom(dir, 'pnpm', ['exec', 'vite', '--port', '5281', '--strictPort'], 5281, '/src/app/app.ts');
      assert.match(app, /ɵɵdefineComponent/);
    });

    it('app-ssr: builds and prerenders, passes its spec, and renders pages in dev and from server.ts', async () => {
      const dir = scaffoldApp('vite-ssr', 'app-ssr');
      sh(dir, 'pnpm', ['install']);
      assertTemplateErrorFailsBuild(dir, 'pnpm', ['run', 'build']);
      sh(dir, 'pnpm', ['run', 'build']);
      assert.ok(existsSync(join(dir, 'dist', 'server', 'server.js')));
      assert.match(readFileSync(join(dir, 'dist', 'client', 'index.html'), 'utf8'), /ng-server-context="ssg"/, 'the home page is prerendered');
      assert.match(sh(dir, 'pnpm', ['test']), /1 passed/);
      const dev = await fetchFrom(dir, 'pnpm', ['exec', 'vite', '--port', '5282', '--strictPort'], 5282, '/', html);
      assert.match(dev, /Clicks: 0/);
      const built = await fetchFrom(dir, 'pnpm', ['start'], 5283, '/', html);
      assert.match(built, /Clicks: 0/);
      assert.match(built, /ng-server-context="ssg"/);
    });
  });

  describe('with Vite+, after vp migrate', {skip: !hasVp && '`vp` is not on PATH'}, () => {
    for (const [template, port] of [
      ['app', 5284],
      ['app-ssr', 5285],
    ]) {
      it(`${template}: migrates, then passes vp check, vp build and vp test, and reports a template error`, async () => {
        const dir = scaffoldApp(`vp-${template}`, template);
        sh(dir, 'git', ['init', '-q']);
        sh(dir, 'vp', ['migrate', '--no-interactive', '--no-agent', '--no-editor']);
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        assert.equal(pkg.scripts.build, 'vp build');
        assert.match(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), /vite: npm:@voidzero-dev\/vite-plus-core@/);
        // vp create formats the project after the template exits; vp migrate leaves that to you.
        sh(dir, 'vp', ['check', '--fix']);
        sh(dir, 'vp', ['check']);
        // Before the real build: a failed build empties dist.
        assertTemplateErrorFailsBuild(dir, 'vp', ['build']);
        sh(dir, 'vp', ['build']);
        assert.match(sh(dir, 'vp', ['test', 'run']), /1 passed/);
        if (template === 'app-ssr') {
          assert.match(await fetchFrom(dir, 'vp', ['dev', '--port', String(port), '--strictPort'], port, '/', html), /Clicks: 0/);
          assert.match(await fetchFrom(dir, process.execPath, ['dist/server/server.js'], port + 10, '/', html), /Clicks: 0/);
        } else {
          assert.match(await fetchFrom(dir, 'vp', ['dev', '--port', String(port), '--strictPort'], port, '/src/app/app.ts'), /ɵɵdefineComponent/);
        }
      });
    }
  });

  after(() => {
    if (!process.env.KEEP_APPS) {
      rmSync(work, {recursive: true, force: true, maxRetries: 5});
    } else {
      console.log(`apps kept in ${work}`);
    }
  });
});
