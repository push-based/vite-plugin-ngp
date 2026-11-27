// Production server for the playground: serves dist/client as static files and renders every
// other GET request with the server bundle. Plain node:http, so it needs no dependencies.
// Run `vite build` first.
//
// The build has one folder per locale, in dist/client and dist/server alike. A request for
// /de/... is answered from dist/client/de, or rendered by dist/server/de/main.server.js.
import {createReadStream, existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname, join, normalize} from 'node:path';
import {pathToFileURL} from 'node:url';

const dist = join(import.meta.dirname, 'dist');
const sourceLocale = 'en-US';
const locales = new Map();
for (const locale of readdirSync(join(dist, 'server'))) {
  const entry = join(dist, 'server', locale, 'main.server.js');
  if (existsSync(entry)) {
    const {default: render} = await import(pathToFileURL(entry).href);
    // The browser's index.html plus Angular's event dispatch contract, which event replay needs.
    const template = readFileSync(join(dist, 'server', locale, 'index.server.html'), 'utf8');
    locales.set(locale, {render, template, client: join(dist, 'client', locale)});
  }
}
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/** The first built locale the browser accepts, else the source locale. */
function preferredLocale(acceptLanguage = '') {
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase();
    const match = [...locales.keys()].find((l) => l.toLowerCase() === tag || l.toLowerCase().split('-')[0] === tag.split('-')[0]);
    if (tag && match) {
      return match;
    }
  }
  return sourceLocale;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const [, first = '', ...rest] = url.pathname.split('/');
  const locale = locales.get(first);
  if (!locale) {
    // Not under a locale: send the browser to the same page in its language.
    res.writeHead(302, {Location: `/${preferredLocale(req.headers['accept-language'])}${url.pathname}${url.search}`});
    res.end();
    return;
  }
  const path = '/' + rest.join('/');
  const file = join(locale.client, normalize(decodeURIComponent(path)));
  if (file.startsWith(locale.client) && path !== '/' && path !== '/index.html' && existsSync(file) && statSync(file).isFile()) {
    const immutable = path.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
    return;
  }
  try {
    const html = await locale.render(url.pathname + url.search, locale.template);
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  } catch (error) {
    console.error(error);
    res.writeHead(500, {'Content-Type': 'text/plain'});
    res.end('Server error');
  }
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`playground: http://localhost:${port} (${[...locales.keys()].join(', ')})`));
