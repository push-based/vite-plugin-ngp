// ngp-extract-i18n: writes the app's i18n messages to a translation file. See extract.ts.
import {parseArgs} from 'node:util';
import {extractMessages, type ExtractFormat} from './extract.js';

const USAGE = `Usage: ngp-extract-i18n [options]

Extracts i18n messages from an Angular app built with vite-plugin-ngp.

  --root <dir>          Vite project root (default: current directory)
  -c, --config <file>   Vite config file (default: Vite's lookup in the root)
  -f, --format <fmt>    xlf (default), xlf2, xmb, json or arb
  -o, --out-file <file> Output file (default: src/locale/messages.<ext>)
  --duplicates <how>    Same id, different text: error, warning (default) or ignore`;

const DUPLICATES = ['error', 'warning', 'ignore'] as const;

let values;
try {
  ({values} = parseArgs({
    options: {
      root: {type: 'string'},
      config: {type: 'string', short: 'c'},
      format: {type: 'string', short: 'f'},
      'out-file': {type: 'string', short: 'o'},
      duplicates: {type: 'string'},
      help: {type: 'boolean', short: 'h'},
    },
  }));
} catch (error) {
  // An unknown flag or a flag without its value: say which, then how to call it, not a stack trace.
  console.error(`${error instanceof Error ? error.message : error}\n\n${USAGE}`);
  process.exit(1);
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

// extractMessages checks the format itself; an unknown duplicates value would silently act as
// 'warning', so it's checked here.
const duplicates = values.duplicates as (typeof DUPLICATES)[number] | undefined;
if (duplicates !== undefined && !DUPLICATES.includes(duplicates)) {
  console.error(`ngp-extract-i18n: unknown --duplicates '${duplicates}'. Use one of ${DUPLICATES.join(', ')}.`);
  process.exit(1);
}

try {
  const {outFile, messages} = await extractMessages({
    root: values.root,
    configFile: values.config,
    format: values.format as ExtractFormat | undefined,
    outFile: values['out-file'],
    duplicates,
  });
  console.log(`Extracted ${messages} messages to ${outFile}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
