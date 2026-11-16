// The TypeScript the plugin parses with: TypeScript 6, the copy Angular's compiler uses.
//
// The package also depends on TypeScript 7, as `typescript7: npm:typescript@7.0.2`, for the
// type-check's CLI. pnpm 11 and later link that copy under the name `typescript` too, so inside the
// plugin `import 'typescript'` resolved to TypeScript 7 there, whose JavaScript API has no
// `ScriptTarget`: a `.ts` edit in the dev server and every template type error threw. Asking
// @angular/compiler-cli for its `typescript` gets the app's TypeScript 6 with npm, yarn and every
// pnpm, because compiler-cli has no TypeScript of its own to confuse it with.
import {createRequire} from 'node:module';
import type * as TS from 'typescript';

const require = createRequire(import.meta.url);

export const ts: typeof TS = createRequire(require.resolve('@angular/compiler-cli/package.json'))('typescript');
