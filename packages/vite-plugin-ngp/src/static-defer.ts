import {parseSync} from 'vite';

/**
 * `test.jitCompat` keeps `@defer` dependencies as static imports, so class metadata stays
 * synchronous, as under JIT. ngp has no switch for that alone: it keeps them static when it
 * compiles for HMR (`canDeferDeps = !ctx.enableHmr` in its processor), since an HMR update has to
 * list the same dependencies whatever the template becomes. So specs compile with `enableHmr`,
 * and this removes the HMR code that comes with it: after each component, an IIFE that defines
 * `<Class>_HmrLoad` and calls it at once whenever `ngDevMode` is on, which it is in specs. That
 * call imports `./@ng/component?c=…` from the module's URL, which only the dev server serves.
 *
 * Each IIFE is overwritten with spaces, newlines kept, so every line and column of the rest stays
 * where it was and ngp's source map still holds.
 */
export function blankHmrInitializers(code: string, file: string): string {
  if (!code.includes('_HmrLoad(')) {
    return code;
  }
  const {program, errors} = parseSync(file, code, {lang: 'ts', sourceType: 'module'});
  if (errors.length > 0) {
    throw new Error(`${file}: ${errors[0]!.message}`);
  }
  let out = code;
  // From the end, so earlier offsets stay valid. Blanking keeps the length anyway.
  for (const statement of [...program.body].reverse()) {
    if (isHmrInitializer(statement)) {
      out = out.slice(0, statement.start) + out.slice(statement.start, statement.end).replace(/[^\r\n]/g, ' ') + out.slice(statement.end);
    }
  }
  return out;
}

type Node = {type: string; start: number; end: number; [key: string]: any};

/** `((): any => { ...; function X_HmrLoad(t) {...} ... })();` at the top level. */
function isHmrInitializer(statement: Node): boolean {
  if (statement.type !== 'ExpressionStatement') {
    return false;
  }
  const call = unwrap(statement['expression']);
  if (call.type !== 'CallExpression' || call['arguments'].length > 0) {
    return false;
  }
  const fn = unwrap(call['callee']);
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') {
    return false;
  }
  const body: Node[] = fn['body']?.body ?? [];
  return body.some((s) => s.type === 'FunctionDeclaration' && /_HmrLoad$/.test(s['id']?.name ?? ''));
}

function unwrap(node: Node): Node {
  while (node.type === 'ParenthesizedExpression') {
    node = node['expression'];
  }
  return node;
}
