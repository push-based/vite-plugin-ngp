// Moves every @angular/* package the workspace installs to another release, to run the tests on an
// Angular the plugin accepts but the repo doesn't pin. The plugin's peer range stays as it is.
//
//   node packages/vite-plugin-ngp/scripts/use-angular.mjs newest    the newest release in the peer range
//   node packages/vite-plugin-ngp/scripts/use-angular.mjs 22.3.0    that release
//
// It only rewrites package.json files. Afterwards run `pnpm install --no-frozen-lockfile`, then the
// tests, without `pnpm build` or `pnpm toolchain` in between: the point is to run the plugin and
// the ngp build made on the pinned release against another one, as an app on that release does.
// `git checkout` the manifests and pnpm-lock.yaml to go back. ci.yml runs it as its last steps.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
// The workspace's own manifests. create-ngp's templates keep the pinned release (check-pins.mjs).
const MANIFESTS = ['package.json', 'packages/vite-plugin-ngp/package.json', 'playground/package.json', 'site/package.json'];

const wanted = process.argv[2];
if (!wanted) {
  console.error('usage: use-angular.mjs <version> | newest');
  process.exit(1);
}
const range = JSON.parse(readFileSync(join(root, 'packages/vite-plugin-ngp/package.json'), 'utf8')).peerDependencies['@angular/compiler'];
const version = wanted === 'newest' ? newestIn(range) : wanted;

for (const file of MANIFESTS) {
  const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'));
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@angular/')) {
        manifest[field][name] = version;
      }
    }
  }
  writeFileSync(join(root, file), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`every @angular/* package in the workspace is now ${version} (the plugin accepts ${range})`);

/** The newest published @angular/compiler the range accepts. A release beats its own prereleases. */
function newestIn(range) {
  const out = execFileSync('npm', ['view', `@angular/compiler@${range}`, 'version', '--json'], {encoding: 'utf8'});
  const versions = [JSON.parse(out)].flat();
  if (versions.length === 0) {
    throw new Error(`no @angular/compiler on npm satisfies ${range}`);
  }
  const key = (v) => {
    const [core, pre] = v.split('-');
    return [...core.split('.').map(Number), pre ? 0 : 1];
  };
  // A stable sort, so prereleases of one version keep the order npm lists them in, oldest first.
  return versions
    .sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      const i = ka.findIndex((n, j) => n !== kb[j]);
      return i === -1 ? 0 : ka[i] - kb[i];
    })
    .at(-1);
}
