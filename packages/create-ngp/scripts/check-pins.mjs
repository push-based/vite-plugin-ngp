// Checks that every version a template pins is the one the repo builds and tests the plugin with:
// Angular from toolchain/versions.env, the rest from the playground, and the server packages of
// app-ssr from the plugin's devDependencies, which its @angular/ssr tests run with. The plugin's own version isn't
// in the templates; create-ngp writes its own version there, and Nx releases both packages together.
// `node scripts/check-pins.mjs` exits 1 and lists the differences; prepack runs it.
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const pkgDir = join(import.meta.dirname, '..');
const root = join(pkgDir, '..', '..');
const PLUGIN = '@push-based/vite-plugin-ngp';

/** The version each dependency must have, by name; Angular packages by prefix. */
export function expectedPins() {
  const env = readFileSync(join(root, 'toolchain', 'versions.env'), 'utf8');
  const angular = /^ANGULAR_NPM_VERSION=(.+)$/m.exec(env)?.[1]?.trim();
  if (!angular) {
    throw new Error('ANGULAR_NPM_VERSION is missing from toolchain/versions.env');
  }
  const playground = JSON.parse(readFileSync(join(root, 'playground', 'package.json'), 'utf8'));
  const all = {...playground.dependencies, ...playground.devDependencies};
  const plugin = JSON.parse(readFileSync(join(root, 'packages', 'vite-plugin-ngp', 'package.json'), 'utf8')).devDependencies;
  return {
    angular,
    others: {
      ...Object.fromEntries(['rxjs', 'tslib', 'typescript', 'vite', 'vitest'].map((name) => [name, all[name]])),
      ...Object.fromEntries(['express', '@types/express', '@types/node'].map((name) => [name, plugin[name]])),
    },
  };
}

/** Every pin in every template that differs from the repo's, as readable lines. */
export function pinMismatches() {
  const {angular, others} = expectedPins();
  const problems = [];
  const templates = join(pkgDir, 'templates');
  for (const template of readdirSync(templates)) {
    const pkg = JSON.parse(readFileSync(join(templates, template, 'package.json'), 'utf8'));
    for (const [name, version] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) {
      if (name === PLUGIN) {
        continue;
      }
      const expected = name.startsWith('@angular/') ? angular : others[name];
      if (expected === undefined) {
        problems.push(`templates/${template}: ${name} has no source of truth; add it to scripts/check-pins.mjs`);
      } else if (version !== expected) {
        problems.push(`templates/${template}: ${name} is ${version}, the repo uses ${expected}`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = pinMismatches();
  if (problems.length > 0) {
    console.error(`create-ngp's templates pin other versions than the repo:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('create-ngp: template pins match the repo');
}
