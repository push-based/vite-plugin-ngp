// blankHmrInitializers on output shaped like ngp's in HMR mode: two components, each followed by
// its HMR IIFE. Run `pnpm build` first.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {blankHmrInitializers} from '../dist/static-defer.js';

const hmr = (name) => `((): any => {
  const id = 'src%2Fa.ts%40${name}';
  function ${name}_HmrLoad(t: any): any {
    import(/* @vite-ignore */ i0.ɵɵgetReplaceMetadataURL(id,t,import.meta.url)).then((m: any): any => (m.default && i0.ɵɵreplaceMetadata(${name},m.default,[i0],[],import.meta,id)));
  }
  (((typeof ngDevMode === 'undefined') || ngDevMode) && ${name}_HmrLoad(Date.now()));
}
)();`;
const debugInfo = (name) => `((): any => {
  (((typeof ngDevMode === 'undefined') || ngDevMode) && i0.ɵsetClassDebugInfo(${name},{className: '${name}'}));
}
)();`;
const code = ['import * as i0 from "@angular/core";', 'export class A {}', debugInfo('A'), hmr('A'), 'export class B {}', debugInfo('B'), hmr('B'), ''].join('\n');

test('blanks each HMR IIFE, keeps everything else, and keeps every offset', () => {
  const out = blankHmrInitializers(code, '/app/src/a.ts');
  assert.equal(out.length, code.length);
  assert.equal(out.split('\n').length, code.split('\n').length);
  assert.doesNotMatch(out, /HmrLoad|getReplaceMetadataURL/);
  // The debug-info IIFEs aren't HMR code.
  assert.equal(out.match(/ɵsetClassDebugInfo/g)?.length, 2);
  // Every surviving line is where it was.
  const lines = code.split('\n');
  out.split('\n').forEach((line, i) => {
    if (line.trim()) assert.equal(line, lines[i]);
  });
});

test('code without HMR code comes back as it was', () => {
  const plain = 'export class A {}\n';
  assert.equal(blankHmrInitializers(plain, '/app/src/a.ts'), plain);
});
