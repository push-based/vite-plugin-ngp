// Production server: serves dist/client as static files and renders every other GET request with
// the server bundle. Plain node:http, so it needs no dependencies. Run `npm run build` first.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = join(import.meta.dirname, 'dist');
const client = join(dist, 'client');
const { default: render } = await import(
  pathToFileURL(join(dist, 'server', 'main.server.js')).href
);
const template = readFileSync(join(client, 'index.html'), 'utf8');
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const file = join(client, normalize(decodeURIComponent(url.pathname)));
  if (
    file.startsWith(client) &&
    url.pathname !== '/' &&
    url.pathname !== '/index.html' &&
    existsSync(file) &&
    statSync(file).isFile()
  ) {
    const immutable = url.pathname.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
    return;
  }
  try {
    const html = await render(url.pathname + url.search, template);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`http://localhost:${port}`));
