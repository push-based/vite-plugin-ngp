// The linker turns a library's partial declarations into runtime definitions, with Angular's
// FileLinker over Vite's oxc parser (decision 65 in docs/decisions.md). Checked on a hand-written
// module and on Angular's own packages. Run `pnpm build` first.

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {test} from 'node:test';
import {parseSync} from 'vite';
import {link} from '../dist/linker.js';

const require = createRequire(import.meta.url);
const LIBRARY_FILE = '/app/node_modules/ui-kit/fesm2022/ui-kit.mjs';

const component = `import * as i0 from '@angular/core';
export class Hello {
  static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "22.0.0", ngImport: i0, type: Hello, deps: [], target: i0.ɵɵFactoryTarget.Component });
  static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "22.0.0", type: Hello, isStandalone: true, selector: "ui-hello", ngImport: i0, template: "<p>Hello {{ name }}</p>", isInline: true });
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "22.0.0", ngImport: i0, type: Hello, decorators: [{ type: Component, args: [{ selector: 'ui-hello', template: '<p>Hello {{ name }}</p>' }] }] });
`;

/** Parses the linked code the way Vite would, to show it's still a valid module. */
function parses(code) {
  const {errors} = parseSync(LIBRARY_FILE, code, {lang: 'js', sourceType: 'module'});
  assert.deepEqual(errors, []);
}

test('links a component and its factory, and leaves nothing partial behind', () => {
  const {code} = link(component, LIBRARY_FILE);
  parses(code);
  assert.doesNotMatch(code, /ɵɵngDeclare/);
  assert.match(code, /i0\.ɵɵdefineComponent\(\{/);
  assert.match(code, /static ɵfac = function Hello_Factory\(/);
  // The template compiled to instructions; the string is gone.
  assert.match(code, /ɵɵdomElementStart\(0, "p"\)/);
  assert.match(code, /ɵɵtextInterpolate1\("Hello ", ctx\.name\)/);
  assert.doesNotMatch(code, /<p>Hello \{\{ name \}\}<\/p>", isInline/);
});

test('keeps each declaration inside its own range', () => {
  const {code} = link(component, LIBRARY_FILE);
  // Everything outside the three calls is untouched: the import, the class, the statics' names.
  assert.match(code, /^import \* as i0 from '@angular\/core';\nexport class Hello \{\n  static ɵfac = /);
  assert.match(code, /\n  static ɵcmp = /);
  assert.match(code, /\n\}\n/);
});

test('turns class metadata into a dev-mode-only call', () => {
  const {code} = link(component, LIBRARY_FILE);
  assert.match(code, /ngDevMode/);
  assert.match(code, /ɵsetClassMetadata\(Hello, /);
});

test('has a source map that keeps the import where it was', () => {
  const {map} = link(component, LIBRARY_FILE);
  assert.equal(map.sources[0], LIBRARY_FILE);
  assert.equal(map.sourcesContent[0], component);
  assert.ok(map.mappings.length > 0);
});

test('leaves a module without declarations, and Angular core itself, alone', () => {
  assert.equal(link(`export const x = 1;\n`, LIBRARY_FILE), null);
  assert.equal(link(component, '/app/node_modules/@angular/core/fesm2022/core.mjs'), null);
  assert.equal(link(component, '/app/node_modules/@angular/compiler/fesm2022/compiler.mjs'), null);
});

test('names the file and the declaration when the metadata is not static', () => {
  const dynamic = component.replace('selector: "ui-hello"', '...extra');
  assert.throws(() => link(dynamic, LIBRARY_FILE), /Failed to link ɵɵngDeclareComponent in .*ui-kit\.mjs: .*expected a property assignment/);
});

test('links every declaration in Angular’s own packages', async () => {
  for (const pkg of ['@angular/common', '@angular/router', '@angular/platform-browser']) {
    // The entry re-exports from chunks, so the declarations are spread over the whole directory.
    const dir = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'fesm2022');
    let declarations = 0;
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.mjs')) {
        continue;
      }
      const file = path.join(dir, name);
      const source = await fs.readFile(file, 'utf8');
      const linked = link(source, file);
      if (!source.includes('ɵɵngDeclare')) {
        assert.equal(linked, null, `${file} has nothing to link`);
        continue;
      }
      declarations++;
      parses(linked.code);
      assert.doesNotMatch(linked.code, /ɵɵngDeclare/, `${file} should be fully linked`);
    }
    assert.ok(declarations > 0, `${pkg} should ship partial declarations`);
  }
});
