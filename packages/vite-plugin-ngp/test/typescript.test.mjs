// The plugin parses with the TypeScript Angular's compiler uses, never with the TypeScript 7 it
// also depends on for the type-check's CLI. pnpm 11 and later link that one under the name
// `typescript` inside the plugin, so a plain `import 'typescript'` got TypeScript 7 there.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {ts} from '../dist/typescript.js';

test('parses with the TypeScript @angular/compiler-cli uses', () => {
  const require = createRequire(import.meta.url);
  const angularTs = createRequire(require.resolve('@angular/compiler-cli/package.json'))('typescript');
  assert.equal(ts, angularTs);
  assert.match(ts.version, /^6\./);
  assert.equal(typeof ts.createSourceFile, 'function');
  assert.equal(typeof ts.ScriptTarget.Latest, 'number');
});
