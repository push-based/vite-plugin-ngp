// Fails when the docs site has drifted from the code. Run by `pnpm docs:check` and `pnpm test`.
//
// It checks that:
//   - every option in the plugin's NgpPluginOptions has a row in content/configuration.md, with
//     the type the source declares;
//   - every page in content/ is in DOCS in src/app/docs.ts, and every DOCS entry has a page;
//   - every page has a title and a description in its front matter;
//   - every link between pages, in the markdown and on the home page, points at a page and a
//     heading that exist;
//   - every figure a page embeds exists next to it;
//   - content/compatibility.md gives each of the plugin's peer ranges, and its Node range, as
//     package.json declares it.
//
// Usage: node site/scripts/check-docs.ts

import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {renderMarkdown} from './markdown.ts';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(site);
const problems: string[] = [];

// 1. Plugin options against the Configuration table.
const pluginSource = path.join(repo, 'packages/vite-plugin-ngp/src/index.ts');
const sourceFile = ts.createSourceFile(pluginSource, await readFile(pluginSource, 'utf8'), ts.ScriptTarget.Latest, true);
const options: string[] = [];
const optionTypes = new Map<string, string>();
sourceFile.forEachChild((node) => {
  if (ts.isInterfaceDeclaration(node) && node.name.text === 'NgpPluginOptions') {
    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) {
        options.push(member.name.text);
        optionTypes.set(member.name.text, ts.isPropertySignature(member) && member.type ? member.type.getText() : 'unknown');
      }
    }
  }
});
if (options.length === 0) {
  problems.push(`couldn't find NgpPluginOptions in ${path.relative(repo, pluginSource)}`);
}
// Type aliases the options use, such as Engine = 'native' | 'wasm', so the table can spell them out.
const aliases = new Map<string, string>();
for (const file of await readdir(path.dirname(pluginSource))) {
  if (!file.endsWith('.ts')) continue;
  const source = ts.createSourceFile(file, await readFile(path.join(path.dirname(pluginSource), file), 'utf8'), ts.ScriptTarget.Latest, true);
  source.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type.getText());
  });
}
const configuration = await readFile(path.join(site, 'content/configuration.md'), 'utf8');
const squash = (type: string) => type.replace(/\s+/g, '');
for (const option of options) {
  // A row is | `option` | `type`<br>Default ... | what it does |: the type, then the default on
  // its own line in the same cell, so the table fits the docs column without breaking words.
  const row = new RegExp(`^\\| \`${option}\` \\| \`((?:[^\`]|\\\\\\|)+)\`(?:<br>| \\|)`, 'm').exec(configuration);
  if (!row) {
    problems.push(`option \`${option}\` has no row in the Options table of site/content/configuration.md, as | \`${option}\` | \`type\`<br>Default ... | what it does |`);
    continue;
  }
  const documented = squash(row[1].replace(/\\\|/g, '|'));
  const declared = optionTypes.get(option)!;
  if (documented !== squash(declared) && documented !== squash(aliases.get(declared) ?? '')) {
    problems.push(`option \`${option}\` is \`${declared}\` in the plugin, but configuration.md says \`${row[1]}\``);
  }
}

// 2. Pages against DOCS.
const docsSource = await readFile(path.join(site, 'src/app/docs.ts'), 'utf8');
const entries = [...docsSource.matchAll(/\{path: '([^']+)',[^\n]*?content\/([^']+)\.md'/g)].map((m) => ({path: m[1], file: m[2]}));
for (const entry of entries) {
  if (entry.path !== entry.file) {
    problems.push(`DOCS entry '${entry.path}' loads content/${entry.file}.md: keep the route and the file name the same`);
  }
}
const files = (await readdir(path.join(site, 'content'))).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
for (const file of files) {
  if (!entries.some((e) => `${e.file}.md` === file)) {
    problems.push(`site/content/${file} isn't in DOCS in site/src/app/docs.ts, so the site doesn't show it`);
  }
}
for (const entry of entries) {
  if (!files.includes(`${entry.file}.md`)) {
    problems.push(`DOCS entry '${entry.path}' has no site/content/${entry.file}.md`);
  }
}

// 3. Front matter, and the ids each page's headings get.
const ids = new Map<string, Set<string>>();
const links: {from: string; href: string}[] = [];
for (const file of files) {
  const source = await readFile(path.join(site, 'content', file), 'utf8');
  const page = file.replace(/\.md$/, '');
  const doc = await renderMarkdown(source, page);
  if (!/^---\n[\s\S]*?\btitle:\s*\S/.test(source)) problems.push(`site/content/${file} has no title in its front matter`);
  if (!/^---\n[\s\S]*?\bdescription:\s*\S/.test(source)) problems.push(`site/content/${file} has no description in its front matter`);
  ids.set(page, new Set([...doc.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])));
  // Figures: ![caption](charts/name.svg) inlines a file next to the page, which has to exist.
  for (const m of source.matchAll(/!\[[^\]]*\]\(([^)\s]+\.svg)\)/g)) {
    if (!existsSync(path.join(site, 'content', m[1]))) problems.push(`site/content/${file} embeds '${m[1]}', but there's no site/content/${m[1]}; \`node bench/charts.mjs\` draws the charts`);
  }
  for (const m of doc.html.matchAll(/<a href="([^"]+)"/g)) {
    links.push({from: `site/content/${file}`, href: m[1]});
  }
}

// 4. Links between pages: bare paths in markdown, routerLink (+ fragment) on the home page.
const home = await readFile(path.join(site, 'src/app/pages/home.html'), 'utf8');
for (const m of home.matchAll(/routerLink="\/([^"]*)"(?:\s+fragment="([^"]+)")?/g)) {
  links.push({from: 'site/src/app/pages/home.html', href: m[1] + (m[2] ? `#${m[2]}` : '')});
}
for (const {from, href} of links) {
  if (/^[a-z]+:/i.test(href) || href.startsWith('/') || href.startsWith('#')) {
    if (href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//'))) {
      problems.push(`${from} links to '${href}': link to other pages by bare path, such as 'configuration#options'`);
    }
    continue;
  }
  const [page, fragment] = href.split('#');
  if (page === '') {
    continue; // the home page
  }
  if (!ids.has(page)) {
    problems.push(`${from} links to '${href}', but there's no page '${page}'`);
  } else if (fragment && !ids.get(page)!.has(fragment)) {
    problems.push(`${from} links to '${href}', but '${page}' has no heading with id '${fragment}'`);
  }
}

// 5. The ranges on the Compatibility page against the plugin's package.json. Every peer, and the
// Node range, has to be on the page as written, and the Angular peers have to share one range.
const pkg = JSON.parse(await readFile(path.join(repo, 'packages/vite-plugin-ngp/package.json'), 'utf8')) as {
  peerDependencies: Record<string, string>;
  engines: {node: string};
};
const compatibility = await readFile(path.join(site, 'content/compatibility.md'), 'utf8');
const angularRanges = new Set(Object.entries(pkg.peerDependencies).filter(([name]) => name.startsWith('@angular/')).map(([, range]) => range));
if (angularRanges.size !== 1) {
  problems.push(`the plugin's @angular/* peers have different ranges (${[...angularRanges].join(', ')}): they move together`);
}
for (const [name, range] of [...Object.entries(pkg.peerDependencies), ['node', pkg.engines.node]]) {
  if (!compatibility.includes(`\`${range}\``)) {
    problems.push(`the plugin's package.json accepts ${name} \`${range}\`, but site/content/compatibility.md doesn't say so`);
  }
}

if (problems.length > 0) {
  console.error(`The docs site is out of step with the code (${problems.length}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nCLAUDE.md says which page covers what. Fix the docs in the same commit as the change.');
  process.exit(1);
}
console.log(`docs check: ${options.length} options, ${entries.length} pages, ${links.length} links, all in step`);
