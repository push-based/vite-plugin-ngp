// What create-ngp does, without prompts or output, so the tests can call each step.
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import mri from 'mri';

export const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');

/** The templates, in the order the prompt lists them. `extends` is copied first, then the template over it. */
export const TEMPLATES = [
  {name: 'app', label: 'App', hint: 'rendered in the browser, with routing and a Vitest spec'},
  {name: 'app-ssr', label: 'App with server rendering', hint: 'app, plus @angular/ssr: an Express server, prerendering and hydration', extends: 'app'},
];

export const DEFAULT_DIR = 'ngp-app';
export const DEFAULT_TEMPLATE = 'app';
export const PLUGIN = '@push-based/vite-plugin-ngp';

/** npm drops a published `.gitignore`, so the templates carry these names and the copy restores them. */
export const RENAMES = {_gitignore: '.gitignore'};

/**
 * @typedef {object} Options
 * @property {string | undefined} dir
 * @property {string | undefined} template
 * @property {boolean} overwrite
 * @property {boolean} interactive
 * @property {boolean} help
 */

/**
 * Reads the command line, without the node and script arguments.
 * @param {string[]} argv
 * @param {{isTTY?: boolean}} [stdin]
 * @returns {Options}
 */
export function parseArgs(argv, stdin = process.stdin) {
  const args = mri(argv, {
    string: ['template'],
    boolean: ['overwrite', 'help', 'interactive'],
    alias: {t: 'template', h: 'help'},
    default: {interactive: Boolean(stdin.isTTY)},
  });
  const [dir] = args._.map(String);
  return {
    dir: dir ? dir.trim().replace(/\/+$/, '') : undefined,
    template: args.template || undefined,
    overwrite: Boolean(args.overwrite),
    interactive: Boolean(args.interactive),
    help: Boolean(args.help),
  };
}

/** @param {string} name */
export function findTemplate(name) {
  return TEMPLATES.find((t) => t.name === name);
}

/** @param {string} name */
export function isValidPackageName(name) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(name);
}

/**
 * The package name for a target directory: its last segment, lowercased, with anything npm
 * doesn't allow turned into dashes. `.` names the project after the current directory.
 * @param {string} dir
 * @param {string} [cwd]
 */
export function toPackageName(dir, cwd = process.cwd()) {
  const name = basename(resolve(cwd, dir));
  if (isValidPackageName(name)) {
    return name;
  }
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/[^a-z\d\-~._]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_DIR;
}

/**
 * Whether a target directory can be written without deleting anything. A `.git` folder doesn't
 * count, so `git init && npm create @push-based/ngp .` works.
 * @param {string} dir
 */
export function isEmptyDir(dir) {
  if (!existsSync(dir)) {
    return true;
  }
  return readdirSync(dir).every((entry) => entry === '.git');
}

/**
 * Deletes everything in `dir` except `.git`.
 * @param {string} dir
 */
export function emptyDir(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry !== '.git') {
      rmSync(join(dir, entry), {recursive: true, force: true});
    }
  }
}

/** The scaffolder's own version, which is the plugin version it pins: Nx releases both together. */
export function ownVersion() {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;
}

/**
 * Copies a template into `targetDir`, which must exist and be empty. Sets the package name, the
 * plugin's version and the page title; nothing else in the template changes.
 * @param {{targetDir: string, template: string, packageName: string, pluginVersion: string}} options
 */
export function scaffold({targetDir, template, packageName, pluginVersion}) {
  const chosen = findTemplate(template);
  if (!chosen) {
    throw new Error(`Unknown template "${template}". Choose one of: ${TEMPLATES.map((t) => t.name).join(', ')}.`);
  }
  mkdirSync(targetDir, {recursive: true});
  for (const layer of [chosen.extends, chosen.name]) {
    if (layer) {
      cpSync(join(TEMPLATES_DIR, layer), targetDir, {recursive: true});
    }
  }
  for (const [from, to] of Object.entries(RENAMES)) {
    if (existsSync(join(targetDir, from))) {
      renameSync(join(targetDir, from), join(targetDir, to));
    }
  }

  const pkgPath = join(targetDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = packageName;
  pkg.devDependencies[PLUGIN] = pluginVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  replaceIn(join(targetDir, 'index.html'), '<title>ngp-app</title>', `<title>${escapeHtml(packageName)}</title>`);
  replaceIn(join(targetDir, 'README.md'), '# ngp-app', `# ${packageName}`);
}

/**
 * @param {string} file
 * @param {string} from
 * @param {string} to
 */
function replaceIn(file, from, to) {
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] ?? c);
}

/**
 * The package manager that started us, from the user agent npm, pnpm, yarn and bun all set.
 * @param {string | undefined} userAgent
 */
export function packageManager(userAgent = process.env.npm_config_user_agent) {
  const name = userAgent?.split(' ')[0]?.split('/')[0];
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm';
}

/**
 * The commands printed at the end.
 * @param {string} dir the target as the user typed it, relative to where they are
 * @param {string} pm
 */
export function nextSteps(dir, pm) {
  const run = pm === 'npm' ? 'npm run dev' : `${pm} dev`;
  return [...(dir === '.' ? [] : [`cd ${dir.includes(' ') ? JSON.stringify(dir) : dir}`]), `${pm} install`, run];
}
