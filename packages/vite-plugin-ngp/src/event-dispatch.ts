// Event replay (`withEventReplay()`): Angular's server renderer marks every listener in the page
// with `jsaction`, and a small script, the event dispatch contract, queues the events a user fires
// before the app hydrates. The renderer only sets that up when the document it renders into
// already holds the contract script: it adds the `__jsaction_bootstrap(...)` call after it, or
// removes the script when the page has nothing to replay. The Angular CLI puts the script into the
// server's index.html at build time, and so does this.
import * as fs from 'node:fs';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import type {Plugin, ResolvedConfig} from 'vite';

/** The id Angular looks the contract script up by. */
const CONTRACT_ID = 'ng-event-dispatch-contract';
/** The document a server renders into: the browser's index.html, with the contract. */
export const SERVER_TEMPLATE_FILE = 'index.server.html';

const contracts = new Map<string, string | null>();

/** The contract's source, from the app's own `@angular/core`. Null when that has none. */
function contractOf(root: string): string | null {
  let contract = contracts.get(root);
  if (contract === undefined) {
    try {
      const file = createRequire(path.join(root, 'package.json')).resolve('@angular/core/event-dispatch-contract.min.js');
      contract = fs.readFileSync(file, 'utf8');
    } catch {
      contract = null;
    }
    contracts.set(root, contract);
  }
  return contract;
}

/** A start tag with quoted attribute values read as such, so a `>` inside one doesn't end it. */
const BODY = /<body(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>/i;
/** For a tag the first can't read, such as one with a stray quote in an unquoted value. */
const BODY_LOOSE = /<body\b[^>]*>/i;
const NG_CSP_NONCE = /<[a-z][^>]*?\sngCspNonce\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
/** Comments, and elements whose content is text, not markup. */
const NOT_MARKUP = /<!--[\s\S]*?-->|<(script|style|title|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * `html` with the event dispatch contract in a script right after `<body>`, where the CLI puts
 * it, so it runs before any element a user could click exists. The script gets the page's CSP
 * nonce, as the CLI's does: the `ngCspNonce` attribute, else `cspNonce`, Vite's `html.cspNonce`.
 * A document without a `<body>` tag, or one that has the script already, comes back as it is.
 */
export function addEventDispatchContract(html: string, root: string, cspNonce?: string): string {
  const contract = contractOf(root);
  if (contract === null || html.includes(CONTRACT_ID)) {
    return html;
  }
  // Blanked at the same offsets, so a `<body>` in a comment, a title or a script's string isn't
  // taken for the tag.
  const markup = html.replace(NOT_MARKUP, (text) => ' '.repeat(text.length));
  const body = BODY.exec(markup) ?? BODY_LOOSE.exec(markup);
  if (!body) {
    return html;
  }
  const match = NG_CSP_NONCE.exec(markup);
  // The attribute's value is HTML already, and only a quote could end the new attribute early.
  const written = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').replace(/"/g, '&quot;');
  const nonce = written || (cspNonce ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}<script type="text/javascript" id="${CONTRACT_ID}"${nonce ? ` nonce="${nonce}"` : ''}>${contract}</script>${html.slice(at)}`;
}

/**
 * For a `render(url, document)` server entry: `vite build` writes `index.server.html` next to each
 * `main.server.js`, the browser build's index.html with the contract. The browser's own index.html
 * stays without it: a page nobody rendered on the server has nothing to replay.
 *
 * Written after each of the two builds, from the index.html on disk. The server build empties its
 * folder, so it writes the file again, and in `vite build --watch` an edit that only rebuilds the
 * browser bundle would otherwise leave the file naming chunks that are gone.
 *
 * @param enabled Whether the app renders with `render`, not `@angular/ssr`, which has its manifest.
 * @param folders The folders of the build that hold an index.html: one per locale, else the root.
 */
export function serverTemplatePlugin(enabled: () => boolean, folders: () => string[]): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'vite-plugin-ngp:server-template',
    configResolved(resolved) {
      config = resolved;
    },
    async writeBundle() {
      const name = this.environment.name;
      if (!enabled() || config.command !== 'build' || (name !== 'client' && name !== 'ssr')) {
        return;
      }
      const environments = this.environment.getTopLevelConfig().environments;
      const outDir = (environment: string) => path.resolve(config.root, environments[environment]?.build.outDir ?? config.build.outDir);
      const clientDir = outDir('client');
      const serverDir = outDir('ssr');
      for (const folder of folders()) {
        const index = path.join(clientDir, folder, 'index.html');
        // Not built yet: the browser build writes the file when it has.
        if (!fs.existsSync(index)) {
          continue;
        }
        const html = addEventDispatchContract(await fs.promises.readFile(index, 'utf8'), config.root, config.html?.cspNonce);
        await fs.promises.mkdir(path.join(serverDir, folder), {recursive: true});
        await fs.promises.writeFile(path.join(serverDir, folder, SERVER_TEMPLATE_FILE), html);
      }
    },
  };
}
