#!/usr/bin/env node
// create-ngp: scaffolds an Angular app built by vite-plugin-ngp. Run by `npm create @push-based/ngp`,
// `pnpm create @push-based/ngp` and `vp create @push-based/ngp`. It writes files and nothing else:
// no install, no git init. Vite+ does both after the template exits, and npm users run the
// commands printed at the end.
import {relative, resolve} from 'node:path';
import * as p from '@clack/prompts';
import {
  DEFAULT_DIR,
  DEFAULT_TEMPLATE,
  TEMPLATES,
  emptyDir,
  findTemplate,
  isEmptyDir,
  nextSteps,
  ownVersion,
  packageManager,
  parseArgs,
  scaffold,
  toPackageName,
} from './src/scaffold.js';

const HELP = `Usage: create-ngp [directory] [options]

Scaffolds an Angular app built by vite-plugin-ngp.

Options:
  -t, --template <name>  ${TEMPLATES.map((t) => t.name).join(' or ')} (default: ${DEFAULT_TEMPLATE})
  --overwrite            Empty a directory that isn't empty, without asking
  --interactive          Ask for anything not given (default when run in a terminal)
  --no-interactive       Ask nothing: use the defaults, and stop rather than overwrite
  -h, --help             Show this help

Templates:
${TEMPLATES.map((t) => `  ${t.name.padEnd(9)} ${t.hint}`).join('\n')}

Under Vite+, put the options after --, which vp passes on:
  vp create @push-based/ngp -- my-app --no-interactive --template app-ssr`;

/** @param {string} message */
function fail(message) {
  p.cancel(message);
  process.exit(1);
}

/**
 * @template T
 * @param {T | symbol} value
 * @returns {T}
 */
function answered(value) {
  if (p.isCancel(value)) {
    fail('Cancelled.');
  }
  return /** @type {T} */ (value);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const {interactive} = options;

  // Before anything is asked or deleted.
  if (options.template && !findTemplate(options.template)) {
    fail(`Unknown template "${options.template}". Choose one of: ${TEMPLATES.map((t) => t.name).join(', ')}.`);
  }

  if (interactive) {
    p.intro('Angular on vite-plugin-ngp');
  }

  let dir = options.dir;
  if (!dir) {
    dir = interactive
      ? answered(
          await p.text({
            message: 'Project directory:',
            placeholder: DEFAULT_DIR,
            defaultValue: DEFAULT_DIR,
          }),
        ).trim() || DEFAULT_DIR
      : DEFAULT_DIR;
  }
  const targetDir = resolve(dir);

  if (!isEmptyDir(targetDir)) {
    let overwrite = options.overwrite;
    if (!overwrite && interactive) {
      overwrite = answered(
        await p.confirm({message: `${relative(process.cwd(), targetDir) || 'The current directory'} isn't empty. Delete everything in it?`, initialValue: false}),
      );
    }
    if (!overwrite) {
      fail(`${targetDir} isn't empty. Pass --overwrite to empty it, or pick another directory.`);
    }
    emptyDir(targetDir);
  }

  let template = options.template;
  if (!template) {
    template = interactive
      ? answered(
          await p.select({
            message: 'Template:',
            options: TEMPLATES.map((t) => ({value: t.name, label: t.label, hint: t.hint})),
            initialValue: DEFAULT_TEMPLATE,
          }),
        )
      : DEFAULT_TEMPLATE;
  }

  const packageName = toPackageName(dir);
  scaffold({targetDir, template, packageName, pluginVersion: ownVersion()});

  const steps = nextSteps(relative(process.cwd(), targetDir) || '.', packageManager());
  const done = `Done. Now run:\n\n${steps.map((s) => `  ${s}`).join('\n')}`;
  if (interactive) {
    p.outro(done);
  } else {
    console.log(`Scaffolded ${template} into ${targetDir}.\n\n${done}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
