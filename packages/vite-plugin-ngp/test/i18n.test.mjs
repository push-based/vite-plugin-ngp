// i18n: build-time translation, extraction, and the playground's German build (docs/i18n in
// design.md). Run `pnpm build` first; the last two tests need an ngp toolchain build.

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ɵmakeParsedTranslation as makeParsedTranslation} from '@angular/localize';
import {createBuilder} from 'vite';
import {extractMessages} from '../dist/extract.js';
import {localizeHtml, negotiateLocale, parseTranslationFile, translateChunk} from '../dist/i18n.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const playground = path.join(repo, 'playground');
// Its own cache, for the reason styles.test.mjs gives.
const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp/i18n-cache');
process.env.NGP_TOOLCHAIN ??= path.join(repo, 'toolchain/out');

test('translateChunk translates messages, inlines the locale, and adds locale data', async () => {
  const code = [
    // Non-ASCII before the messages: the parser's offsets must be UTF-16, like JS strings.
    'const ɵüber = "Grüße";',
    // Minified: no semicolon, and the placeholder as a template literal.
    '(globalThis.$localize ??= {}).locale = `___NG_LOCALE_INSERT___`',
    'export const greeting = (name) => $localize`:@@greeting:Hello ${name}:name:!`;',
    'export const missing = $localize`:@@missing:Not translated`;',
    'export const locale = typeof $localize !== "undefined" && $localize.locale;',
  ].join('\n');
  const result = await translateChunk(code, 'chunk.js', {code: 'de'}, {
    translations: {greeting: makeParsedTranslation(['Hallo ', '!'], ['name'])},
    missingTranslation: 'warning',
    localeData: 'globalThis.registered = "de";',
  });
  assert.match(result.code, /`Hallo \$\{name\}!`/);
  assert.match(result.code, /"Not translated"/);
  assert.match(result.code, /\.locale = "de"\s*;globalThis\.registered = "de";/);
  assert.match(result.code, /export const locale = "de";/);
  assert.doesNotMatch(result.code, /\$localize`/);
  assert.deepEqual(
    result.diagnostics.map((d) => d.type),
    ['warning'],
  );
});

test('parseTranslationFile reports a unit it cannot read and keeps the rest, as ng build does', async () => {
  // Ghostfolio's Catalan file has a target with `${emergencyFund}` in it, which the parser reads
  // as the start of an ICU expression. The CLI logs the error and builds; so does the plugin.
  const xlf = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="ca" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="good" datatype="html"><source>Hello</source><target>Hola</target></trans-unit>
      <trans-unit id="bad" datatype="html"><source>Fund</source><target>Fons de \${emergencyFund}</target></trans-unit>
    </body>
  </file>
</xliff>`;
  const logged = {error: [], warn: []};
  const logger = {error: (m) => logged.error.push(m), warn: (m) => logged.warn.push(m), info() {}, warnOnce() {}};
  const translations = await parseTranslationFile('/app/src/locales/messages.ca.xlf', xlf, logger);
  assert.equal(translations.good.messageParts.join(''), 'Hola');
  // The parser keeps what it read of the unit up to the `{`, as it does for the CLI.
  assert.equal(translations.bad.messageParts.join(''), 'Fons de $');
  assert.ok(logged.error.length >= 1, 'expected the unreadable unit to be reported');
  assert.match(logged.error[0], /messages\.ca\.xlf: /);
});

test('localizeHtml sets lang and base href', () => {
  assert.equal(
    localizeHtml('<html lang="en">\n  <head>\n    <title>x</title>', 'de', '/de/'),
    '<html lang="de">\n  <head>\n    <base href="/de/">\n    <title>x</title>',
  );
  assert.equal(localizeHtml('<html><head><base href="/"></head>', 'fr', '/app/fr/'), '<html lang="fr"><head><base href="/app/fr/"></head>');
});

test('negotiateLocale picks the first built locale the browser accepts', () => {
  const locales = [{code: 'en-US'}, {code: 'de'}];
  assert.equal(negotiateLocale('de-CH,de;q=0.9,en;q=0.8', locales)?.code, 'de');
  assert.equal(negotiateLocale('fr;q=0.9,en-GB;q=0.8', locales)?.code, 'en-US');
  assert.equal(negotiateLocale('fr', locales), undefined);
});

test('ngp-extract-i18n prints usage, not a stack trace, for a flag it does not know', () => {
  const bin = path.join(repo, 'packages/vite-plugin-ngp/bin/ngp-extract-i18n.js');
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], {encoding: 'utf8'});

  for (const args of [['--out', 'foo.xlf'], ['--root']]) {
    const bad = run(...args);
    assert.equal(bad.status, 1, `${args.join(' ')}: ${bad.stderr}`);
    assert.doesNotMatch(bad.stderr, /^ {4}at /m);
    assert.match(bad.stderr, /Usage: ngp-extract-i18n \[options\]/);
  }

  const duplicates = run('--duplicates', 'nope');
  assert.equal(duplicates.status, 1);
  assert.match(duplicates.stderr, /unknown --duplicates 'nope'\. Use one of error, warning, ignore\./);

  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: ngp-extract-i18n \[options\]/);
});

test('vite build writes one translated folder per locale', async () => {
  const builder = await createBuilder({root: playground, cacheDir, logLevel: 'silent', build: {write: false}}, null);
  const {output} = await builder.build(builder.environments.client);
  const text = (f) => (typeof f.source === 'string' ? f.source : Buffer.from(f.source).toString('utf8'));
  const html = (locale) => text(output.find((f) => f.fileName === `${locale}/index.html`));
  const js = (locale) => output.filter((f) => f.fileName.startsWith(`${locale}/`) && f.fileName.endsWith('.js')).map(text).join('\n');

  // Every file sits below a locale: nothing is left at the outDir's root.
  assert.deepEqual([...new Set(output.map((f) => f.fileName.split('/')[0]))].sort(), ['de', 'en-US']);
  assert.ok(output.some((f) => f.fileName === 'de/favicon.svg'), 'public files are copied into each locale');
  assert.match(html('en-US'), /<html lang="en-US">/);
  assert.match(html('en-US'), /<base href="\/en-US\/">/);
  assert.match(html('de'), /<html lang="de">/);
  assert.match(html('de'), /<base href="\/de\/">/);
  assert.match(js('en-US'), /one module at a time/);
  assert.match(js('de'), /ein Modul nach dem anderen/);
  // German locale data, inlined where the prelude sets the locale: month names, for DatePipe.
  assert.match(js('de'), /[`"]Oktober[`"]/);
  assert.doesNotMatch(js('en-US'), /[`"]Oktober[`"]/);
  for (const locale of ['en-US', 'de']) {
    assert.doesNotMatch(js(locale), /\$localize`/);
  }
});

test('extractMessages writes the playground messages as XLIFF', async () => {
  const outFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-ngp-')), 'messages.xlf');
  const {messages} = await extractMessages({root: playground, outFile});
  const xliff = await fs.readFile(outFile, 'utf8');
  assert.ok(messages > 20, `expected the playground's messages, got ${messages}`);
  assert.match(xliff, /source-language="en-US"/);
  assert.match(xliff, /<trans-unit id="overviewHeading"/);
  assert.match(xliff, /Skip to content/);
  // Extraction must not leave translated output behind it: same ids as the committed file.
  const committed = await fs.readFile(path.join(playground, 'src/locale/messages.xlf'), 'utf8');
  const ids = (s) => [...s.matchAll(/<trans-unit id="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids(xliff), ids(committed));
});
