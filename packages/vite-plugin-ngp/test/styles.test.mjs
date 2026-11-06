// Component stylesheets go through Vite's CSS pipeline (styles.ts, decisions 32 to 34
// in docs/decisions.md). The first tests check the rewrites on their own. The last two run the
// playground's SCSS component through a real dev server and a real build. Run `pnpm build` first;
// those two need an ngp toolchain build.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createBuilder, createServer} from 'vite';
import {inlineStylesheets, rewriteToUrls, scopeStylesheet, stylesheetName} from '../dist/styles.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const playground = path.join(repo, 'playground');
// Not the playground's own node_modules/.vite: every test file that builds or serves the
// playground would share it, and two writing the type-check tsconfig at once corrupt it.
const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp/styles-cache');
process.env.NGP_TOOLCHAIN ??= path.join(repo, 'toolchain/out');

// ngp's output for two components, cut down to the parts the rewrites look at.
const COMPILED = `
export class A { static ɵcmp = i0.ɵɵdefineComponent({type: A, selectors: [['a']], features: [i0.ɵɵExternalStylesFeature(['/app/a.scss', '/app/shared.css'])], decls: 0, vars: 0, template: function A_Template() {}}); }
export class B { static ɵcmp = i0.ɵɵdefineComponent({type: B, selectors: [['b']], features: [i0.ɵɵExternalStylesFeature(["/app/b.css"])], decls: 0, vars: 0, template: function B_Template() {}, encapsulation: 2}); }
`;

test('scopes a stylesheet to the id the runtime asks for', () => {
  const css = '.x { color: red; } :host { display: block; }';
  assert.equal(
    scopeStylesheet(css, new URLSearchParams('ngcomp=ng-c42&e=0&direct')),
    '.x[_ngcontent-ng-c42] { color: red; } [_nghost-ng-c42] { display: block; }',
  );
  // None and ShadowDom: the runtime sends an empty id.
  assert.equal(scopeStylesheet(css, new URLSearchParams('ngcomp&e=2')), null);
  // Not a component stylesheet.
  assert.equal(scopeStylesheet(css, new URLSearchParams('direct')), null);
  assert.throws(() => scopeStylesheet(css, new URLSearchParams('ngcomp=../evil')), /invalid component stylesheet id/);
});

test('dev: points every external stylesheet at a flat name', () => {
  const {code} = rewriteToUrls(COMPILED);
  assert.match(code, /ɵɵExternalStylesFeature\(\["a\.ngp-[0-9a-f]{8}\.scss", "shared\.ngp-[0-9a-f]{8}\.css"\]\)/);
  assert.match(code, /ɵɵExternalStylesFeature\(\["b\.ngp-[0-9a-f]{8}\.css"\]\)/);
  assert.doesNotMatch(code, /\/app\//);
  assert.equal(stylesheetName('/app/a.scss'), stylesheetName('/app/a.scss'));
  assert.match(rewriteToUrls(COMPILED, undefined, '/@ng/styles-hmr').code, /^import "\/@ng\/styles-hmr";\n/);
  assert.notEqual(stylesheetName('/app/a.scss'), stylesheetName('/other/a.scss'));
});

test('build: imports each stylesheet and scopes only the emulated ones', () => {
  const {code} = inlineStylesheets(COMPILED, new Map([['A', 0], ['B', 2]]));
  assert.match(code, /^import __ngp_style_0 from "\/app\/a\.scss\?ngp-scoped&inline";$/m);
  assert.match(code, /^import __ngp_style_1 from "\/app\/shared\.css\?ngp-scoped&inline";$/m);
  assert.match(code, /^import __ngp_style_2 from "\/app\/b\.css\?inline";$/m);
  assert.ok(code.includes(`features: [((d) => { d.styles = [__ngp_style_0.replaceAll("__ngpcomp__", '%COMP%'), __ngp_style_1.replaceAll("__ngpcomp__", '%COMP%'), ...d.styles]; })]`));
  assert.ok(code.includes(`features: [((d) => { d.styles = [__ngp_style_2, ...d.styles]; })]`));
  assert.doesNotMatch(code, /ɵɵExternalStylesFeature/);
});

test('dev server: compiles the playground SCSS and scopes it to the requested id', async () => {
  const server = await createServer({root: playground, cacheDir, logLevel: 'silent', server: {hmr: false, ws: false}});
  try {
    const client = server.environments.client;
    const component = await client.transformRequest('/src/app/pages/styles/scss-meter.ts');
    const name = component.code.match(/scss-meter\.ngp-[0-9a-f]{8}\.scss/)?.[0];
    assert.ok(name, 'expected the component to reference its stylesheet by a flat name');
    // The listener that reloads <link>s on a style edit comes in with the component.
    assert.match(component.code, /import "\/@id\/__x00__ngp:styles-hmr";/);
    // The browser resolves the name against the page, so it can arrive under any directory.
    const css = await client.transformRequest(`/router/${name}?ngcomp=ng-c7&e=0&direct`);
    assert.match(css.code, /\.meter\[_ngcontent-ng-c7\]\s+\.level-1\.on\[_ngcontent-ng-c7\] \{\s*background: #0ea5e9;/);
    assert.match(css.code, /\[_nghost-ng-c7\]/);
  } finally {
    await server.close();
  }
});

test('build: inlines the playground SCSS, scoped, into the client and server bundles', async () => {
  const builder = await createBuilder({
    root: playground,
    cacheDir,
    logLevel: 'silent',
    environments: {client: {build: {write: false}}, ssr: {build: {write: false}}},
  });
  for (const environment of [builder.environments.client, builder.environments.ssr]) {
    const output = await builder.build(environment);
    // The playground builds with i18n, which writes each locale's copy of a chunk as an asset.
    const js = [output].flat().flatMap((o) => o.output).filter((f) => f.fileName.endsWith('.js'));
    const code = js.map((f) => f.code ?? String(f.source)).join('\n');
    // assert.ok rather than assert.match, which would print the whole bundle on failure.
    const q = '["\'`]';
    assert.ok(/\.meter\[_ngcontent-__ngpcomp__\] \.level-1\.on\[_ngcontent-__ngpcomp__\]\{background:#0ea5e9\}/.test(code), `${environment.name}: scoped SCSS`);
    assert.ok(new RegExp(`\\.replaceAll\\(${q}__ngpcomp__${q},\\s*${q}%COMP%${q}\\)`).test(code), `${environment.name}: placeholder swap`);
    assert.ok(!/ɵɵExternalStylesFeature\(\[/.test(code), `${environment.name}: no external stylesheet URLs left`);
  }
});
