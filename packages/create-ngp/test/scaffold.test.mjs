// Unit tests for create-ngp: argument parsing, names, overwrite rules and what lands on disk.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {
  TEMPLATES,
  emptyDir,
  isEmptyDir,
  nextSteps,
  ownVersion,
  packageManager,
  parseArgs,
  scaffold,
  toPackageName,
} from '../src/scaffold.js';

const CLI = join(import.meta.dirname, '..', 'index.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'create-ngp-'));

/** Every file under `dir`, relative, sorted. */
function files(dir, prefix = '') {
  return readdirSync(join(dir, prefix), {withFileTypes: true})
    .flatMap((e) => (e.isDirectory() ? files(dir, join(prefix, e.name)) : [join(prefix, e.name)]))
    .sort();
}

describe('parseArgs', () => {
  it('reads the directory, template and flags', () => {
    assert.deepEqual(parseArgs(['my-app', '-t', 'app-ssr', '--overwrite', '--no-interactive'], {isTTY: true}), {
      dir: 'my-app',
      template: 'app-ssr',
      overwrite: true,
      interactive: false,
      help: false,
    });
  });

  it('is interactive in a terminal and not otherwise, unless told', () => {
    assert.equal(parseArgs([], {isTTY: true}).interactive, true);
    assert.equal(parseArgs([], {isTTY: false}).interactive, false);
    assert.equal(parseArgs(['--interactive'], {isTTY: false}).interactive, true);
  });

  it('drops a trailing slash and reads --template= and -h', () => {
    const options = parseArgs(['apps/web/', '--template=app', '-h'], {});
    assert.equal(options.dir, 'apps/web');
    assert.equal(options.template, 'app');
    assert.equal(options.help, true);
  });
});

describe('toPackageName', () => {
  it('keeps a valid name', () => assert.equal(toPackageName('my-app'), 'my-app'));
  it('uses the last segment', () => assert.equal(toPackageName('apps/web-shop'), 'web-shop'));
  it('lowercases and replaces what npm rejects', () => assert.equal(toPackageName('My Cool App!'), 'my-cool-app'));
  it('drops leading dots and underscores', () => assert.equal(toPackageName('_private'), 'private'));
  it('names `.` after the current directory', () => assert.equal(toPackageName('.', '/work/Shop Front'), 'shop-front'));
  it('falls back when nothing is left', () => assert.equal(toPackageName('!!!'), 'ngp-app'));
});

describe('overwrite rules', () => {
  it('treats a missing directory, an empty one and one with only .git as empty', () => {
    const dir = tmp();
    assert.equal(isEmptyDir(join(dir, 'missing')), true);
    assert.equal(isEmptyDir(dir), true);
    mkdirSync(join(dir, '.git'));
    assert.equal(isEmptyDir(dir), true);
    writeFileSync(join(dir, 'notes.txt'), '');
    assert.equal(isEmptyDir(dir), false);
  });

  it('empties everything but .git', () => {
    const dir = tmp();
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    writeFileSync(join(dir, 'package.json'), '{}');
    emptyDir(dir);
    assert.deepEqual(readdirSync(dir), ['.git']);
  });
});

describe('scaffold', () => {
  for (const {name} of TEMPLATES) {
    it(`writes the ${name} template with its name, plugin version and title`, () => {
      const dir = join(tmp(), 'shop');
      scaffold({targetDir: dir, template: name, packageName: 'shop', pluginVersion: '9.8.7'});

      assert.ok(existsSync(join(dir, '.gitignore')), '_gitignore is renamed');
      assert.ok(!existsSync(join(dir, '_gitignore')));
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, 'shop');
      assert.equal(pkg.devDependencies['@push-based/vite-plugin-ngp'], '9.8.7');
      assert.equal(pkg.devDependencies.vite !== undefined, true, 'vite is declared, so Vite+ aliases it');
      assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<title>shop<\/title>/);
      assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /^# shop\n/);
      for (const file of ['src/main.ts', 'src/app/app.spec.ts', 'src/test-setup.ts', 'vitest.config.ts', 'pnpm-workspace.yaml']) {
        assert.ok(existsSync(join(dir, file)), file);
      }
    });
  }

  it('adds the server entry, the server and hydration only for app-ssr', () => {
    const app = join(tmp(), 'a');
    const ssr = join(tmp(), 'b');
    scaffold({targetDir: app, template: 'app', packageName: 'a', pluginVersion: '1.0.0'});
    scaffold({targetDir: ssr, template: 'app-ssr', packageName: 'b', pluginVersion: '1.0.0'});

    const extra = files(ssr).filter((f) => !files(app).includes(f));
    assert.deepEqual(extra, ['server.mjs', 'src/main.server.ts']);
    assert.match(readFileSync(join(ssr, 'vite.config.ts'), 'utf8'), /ngp\(\{ ssr: true \}\)/);
    assert.match(readFileSync(join(ssr, 'src/app/app.config.ts'), 'utf8'), /provideClientHydration\(withEventReplay\(\)\)/);
    assert.doesNotMatch(readFileSync(join(app, 'src/app/app.config.ts'), 'utf8'), /provideClientHydration/);
    assert.equal(JSON.parse(readFileSync(join(ssr, 'package.json'), 'utf8')).scripts.start, 'node server.mjs');
  });

  it('rejects an unknown template', () => {
    assert.throws(() => scaffold({targetDir: tmp(), template: 'react', packageName: 'x', pluginVersion: '1.0.0'}), /Unknown template "react"/);
  });
});

describe('next steps', () => {
  it('reads the package manager from the user agent', () => {
    assert.equal(packageManager('pnpm/10.20.0 npm/? node/v26.12.1 darwin arm64'), 'pnpm');
    assert.equal(packageManager('yarn/4.9.0 npm/? node/v26.12.1'), 'yarn');
    assert.equal(packageManager('bun/1.3.0'), 'bun');
    assert.equal(packageManager('npm/11.6.0 node/v26.12.1'), 'npm');
    assert.equal(packageManager(undefined), 'npm');
  });

  it('prints cd, install and dev', () => {
    assert.deepEqual(nextSteps('my-app', 'pnpm'), ['cd my-app', 'pnpm install', 'pnpm dev']);
    assert.deepEqual(nextSteps('my app', 'npm'), ['cd "my app"', 'npm install', 'npm run dev']);
    assert.deepEqual(nextSteps('.', 'npm'), ['npm install', 'npm run dev']);
  });
});

describe('the command', () => {
  const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], {cwd, encoding: 'utf8', env: {...process.env, npm_config_user_agent: 'pnpm/10.20.0'}});

  it('scaffolds without asking when not interactive, pinning its own version of the plugin', () => {
    const cwd = tmp();
    const result = run(['shop', '--no-interactive'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Done\. Now run:\n\n {2}cd shop\n {2}pnpm install\n {2}pnpm dev/);
    const pkg = JSON.parse(readFileSync(join(cwd, 'shop', 'package.json'), 'utf8'));
    assert.equal(pkg.devDependencies['@push-based/vite-plugin-ngp'], ownVersion());
    assert.ok(!existsSync(join(cwd, 'shop', 'src', 'main.server.ts')), 'the default template is app');
  });

  it('uses ngp-app when no directory is given', () => {
    const cwd = tmp();
    assert.equal(run(['--no-interactive', '--template', 'app-ssr'], cwd).status, 0);
    assert.ok(existsSync(join(cwd, 'ngp-app', 'server.mjs')));
  });

  it('refuses a directory that isn’t empty, unless told to overwrite it', () => {
    const cwd = tmp();
    mkdirSync(join(cwd, 'shop'));
    writeFileSync(join(cwd, 'shop', 'keep.txt'), 'mine');

    const refused = run(['shop', '--no-interactive'], cwd);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout + refused.stderr, /isn't empty/);
    assert.ok(existsSync(join(cwd, 'shop', 'keep.txt')));

    assert.equal(run(['shop', '--no-interactive', '--overwrite'], cwd).status, 0);
    assert.ok(!existsSync(join(cwd, 'shop', 'keep.txt')));
    assert.ok(existsSync(join(cwd, 'shop', 'package.json')));
  });

  it('stops on an unknown template before writing anything', () => {
    const cwd = tmp();
    const result = run(['shop', '--no-interactive', '--template', 'vue'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /Unknown template "vue"/);
    assert.ok(!existsSync(join(cwd, 'shop')));
  });

  it('prints help', () => {
    const result = run(['--help'], tmp());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: create-ngp \[directory\] \[options\]/);
    assert.match(result.stdout, /vp create @push-based\/ngp -- my-app --no-interactive --template app-ssr/);
  });
});
