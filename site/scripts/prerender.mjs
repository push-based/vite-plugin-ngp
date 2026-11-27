// Renders every route of the built site to static HTML, for GitHub Pages, and writes the files
// around it: 404.html, sitemap.xml, robots.txt, llms.txt, llms-full.txt, and each page's markdown.
// Run after `vite build`, which with the plugin's `ssr` option writes dist/client (browser) and
// dist/server (server entry).

import {copyFile, cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(site, 'dist/client');
const base = process.env.SITE_BASE ?? '/vite-plugin-ngp/';
const siteUrl = (process.env.SITE_ORIGIN ?? 'https://push-based.github.io') + base;

// The browser's index.html plus Angular's event dispatch contract, which event replay needs.
const template = await readFile(path.join(site, 'dist/server/index.server.html'), 'utf8');
const entry = await import(pathToFileURL(path.join(site, 'dist/server/main.server.js')).href);
const {default: render, routes} = entry;
const docs = await Promise.all(entry.docs.map(async (d) => ({...d, doc: await d.load()})));

// 1. HTML for every route, and the 404 page GitHub Pages serves for unknown paths.
const pages = [...routes.map((route) => ({route, file: path.join(route, 'index.html')})), {route: '404', file: '404.html'}];
for (const {route, file} of pages) {
  const started = performance.now();
  const html = await render(`http://localhost${base}${route}`, template);
  const out = path.join(client, file);
  await mkdir(path.dirname(out), {recursive: true});
  await writeFile(out, html);
  console.log(`prerendered ${base}${route} → dist/client/${file} (${Math.round(performance.now() - started)} ms)`);
}

// 2. Each page's markdown next to its HTML (/configuration.md), for "View as markdown" and llms.txt,
// and the figures the markdown embeds, so they resolve from there too.
for (const d of docs) {
  await copyFile(path.join(site, 'content', `${d.path}.md`), path.join(client, `${d.path}.md`));
}
await cp(path.join(site, 'content/charts'), path.join(client, 'charts'), {recursive: true});

// 3. sitemap.xml and robots.txt.
const today = new Date().toISOString().slice(0, 10);
const urls = [
  {loc: siteUrl, lastmod: today},
  ...docs.map((d) => ({loc: `${siteUrl}${d.path}/`, lastmod: d.doc.updated || today})),
];
await writeFile(
  path.join(client, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`,
);
await writeFile(path.join(client, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);

// 4. llms.txt (https://llmstxt.org): an index an AI assistant can read, and llms-full.txt with every
// page in one file. The plugin isn't in any model's training data.
const sections = [...new Set(docs.map((d) => d.section))];
const llms = [
  '# vite-plugin-ngp',
  '',
  "> A Vite plugin that compiles Angular one module at a time with ngp, Angular's Rust-and-TypeScript preprocessor. It's a prototype: ngp isn't on npm, so the package carries its own build of it, made from Angular's source, and it runs on Angular 22.3 only.",
  '',
  'Each link below is the page as markdown.',
  ...sections.flatMap((section) => [
    '',
    `## ${section}`,
    '',
    ...docs.filter((d) => d.section === section).map((d) => `- [${d.doc.title}](${siteUrl}${d.path}.md): ${d.doc.description}`),
  ]),
  '',
].join('\n');
await writeFile(path.join(client, 'llms.txt'), llms);
const full = await Promise.all(docs.map((d) => readFile(path.join(site, 'content', `${d.path}.md`), 'utf8')));
await writeFile(path.join(client, 'llms-full.txt'), full.join('\n\n---\n\n'));
console.log(`wrote sitemap.xml (${urls.length} URLs), robots.txt, llms.txt, llms-full.txt and ${docs.length} markdown pages`);

// GitHub Pages runs Jekyll unless this file exists, and Jekyll hides files that start with "_".
await writeFile(path.join(client, '.nojekyll'), '');
