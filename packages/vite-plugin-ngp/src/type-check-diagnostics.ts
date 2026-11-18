// Turns TypeScript 7's output over ngp's type-check blocks into diagnostics at template locations.
//
// A type-check block (TCB) is TypeScript that ngp generates per component file. It starts with a
// `TCB for <component .ts path>` comment, wraps each template in `function _tcbN(this: Class)`,
// follows each template expression with a span comment `/*start,end*/`, and ends with a
// `ngp-tcb-template-sources:` comment naming each block's template file. The mapping below is
// Angular's own (compiler-cli's `findSourceLocation` in typecheck/src/tcb_util.ts): from the node
// at the error, walk up to the first node followed by a span comment.

import type * as TS from 'typescript';
import {ts} from './typescript.js';

export interface Diagnostic {
  /** Absolute path. Undefined for diagnostics without a location, like a bad compiler option. */
  file?: string;
  /** 1-based. */
  line?: number;
  /** 1-based, in UTF-16 code units, as TypeScript counts. */
  column?: number;
  /** `TS2339`. */
  code: string;
  message: string;
}

/** A position in a component's template or source file. */
export interface SourceLocation {
  file: string;
  offset: number;
}

const LOCATED = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL = /^error (TS\d+): (.*)$/;

/** Every error in `tsc --pretty false` output. Relative paths resolve against `cwd`. */
export function parseTscOutput(output: string, cwd: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const located = LOCATED.exec(line);
    const global = located ? null : GLOBAL.exec(line);
    if (located) {
      const [, file, row, column, code, message] = located;
      diagnostics.push({file: resolvePath(cwd, file!), line: Number(row), column: Number(column), code: code!, message: message!});
    } else if (global) {
      diagnostics.push({code: global[1]!, message: global[2]!});
    } else if (/^\s/.test(line) && line.trim() && diagnostics.length > 0) {
      // Message chains and "The file is in the program because:" notes are indented.
      diagnostics.at(-1)!.message += '\n' + line;
    }
  }
  return diagnostics;
}

function resolvePath(cwd: string, file: string): string {
  return (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file) ? file : `${cwd}/${file}`).replace(/\\/g, '/');
}

/**
 * Codes Angular drops in type-check blocks (compiler-cli's `shouldReportDiagnostic`): unused
 * variables and functions, the comma operator ngp uses to sequence expressions, and an implicitly
 * typed `$event`. Unused locals are what fail `noUnusedLocals`: no `_tcbN` function is ever called.
 */
const IGNORED_IN_TCB = new Set(['TS6133', 'TS6199', 'TS2695', 'TS7006']);

export function isIgnoredInTcb(code: string): boolean {
  return IGNORED_IN_TCB.has(code);
}

type TemplateSource = {templateFile: string} | {templateExpression: {start: number; end: number}};

const SPAN = /^(\d+),(\d+)$/;
const TEMPLATE_SOURCES = /\/\*ngp-tcb-template-sources:(.*)\*\/\s*$/;

/**
 * Where an error at `line`:`column` of a type-check block belongs in the component's sources.
 *
 * - A location in the template file, or in the component's .ts for an inline template or a host
 *   binding. Span offsets for inline templates are already offsets into the .ts file.
 * - `'ignore'` when Angular would not report it: it sits under a `D:ignore` marker, or it's
 *   outside every `_tcbN` function in a block that inlines the component's own source. TypeScript
 *   reports those on the source file itself.
 * - `null` when the block isn't one ngp wrote, or has no span for the error.
 */
export function locateInTemplate(tcb: string, line: number, column: number): SourceLocation | 'ignore' | null {
  const componentFile = /^ \* TCB for (.+\.[cm]?ts)$/m.exec(tcb)?.[1];
  if (!componentFile) {
    return null;
  }
  const sf = ts.createSourceFile('tcb.ts', tcb, ts.ScriptTarget.Latest, true);
  const lineStarts = sf.getLineStarts();
  if (line < 1 || line > lineStarts.length) {
    return null;
  }
  let node: TS.Node | undefined = tokenAt(sf, lineStarts[line - 1]! + column - 1);
  let span: {start: number; end: number} | null = null;
  while (node && !ts.isFunctionDeclaration(node) && !ts.isSourceFile(node)) {
    const comment = trailingComment(tcb, node);
    if (comment === 'D:ignore') {
      return 'ignore';
    }
    const match = comment && SPAN.exec(comment);
    if (match) {
      span = {start: Number(match[1]), end: Number(match[2])};
      break;
    }
    node = node.parent;
  }
  // Walk on to the block's function, noting whether the span is in its host bindings block.
  let inHostBindings = false;
  while (node && !ts.isFunctionDeclaration(node) && !ts.isSourceFile(node)) {
    if (ts.isIfStatement(node) && tcb.slice(node.expression.pos, node.expression.end).includes('/*hostBindingsBlockGuard*/')) {
      inHostBindings = true;
    }
    node = node.parent;
  }
  const fn = node && ts.isFunctionDeclaration(node) && node.name?.text.startsWith('_tcb') ? node : null;
  if (!fn) {
    // An inline block carries the component's own classes. Anywhere else, report it as it is.
    return sf.statements.some(ts.isClassDeclaration) ? 'ignore' : null;
  }
  if (!span) {
    return null;
  }
  const source = templateSources(tcb)[fn.name!.text.slice(1)];
  if (inHostBindings || !source) {
    return {file: componentFile, offset: span.start};
  }
  if ('templateFile' in source) {
    return {file: source.templateFile, offset: span.start};
  }
  // The template is an expression, like a constant: spans point into its value, which has no
  // place in any file. Angular reports these at the expression.
  return {file: componentFile, offset: source.templateExpression.start};
}

function templateSources(tcb: string): Record<string, TemplateSource> {
  const json = TEMPLATE_SOURCES.exec(tcb)?.[1];
  if (!json) {
    return {};
  }
  try {
    return JSON.parse(json) as Record<string, TemplateSource>;
  } catch {
    return {};
  }
}

/** The innermost node whose text, not counting leading trivia, contains `pos`. */
function tokenAt(sf: TS.SourceFile, pos: number): TS.Node {
  let node: TS.Node = sf;
  for (;;) {
    const child: TS.Node | undefined = node.forEachChild((c) => (c.getStart(sf) <= pos && pos < c.end ? c : undefined));
    if (!child) {
      return node;
    }
    node = child;
  }
}

/** The text of the first `/* *\/` comment right after `node`, if any. */
function trailingComment(text: string, node: TS.Node): string | null {
  return (
    ts.forEachTrailingCommentRange(text, node.end, (pos, end, kind) =>
      kind === ts.SyntaxKind.MultiLineCommentTrivia ? text.slice(pos + 2, end - 2) : undefined,
    ) ?? null
  );
}

/** Converts a character offset to a 1-based line and column. */
export function lineAndColumn(text: string, offset: number): {line: number; column: number} {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return {line, column: offset - before.lastIndexOf('\n')};
}

/** Two lines of context around `line`, with a caret under `column`, in the format Vite's overlay recognizes. */
export function codeFrame(text: string, line: number, column: number): string {
  const lines = text.split(/\r?\n/);
  const first = Math.max(1, line - 2);
  const last = Math.min(lines.length, line + 2);
  const width = String(last).length;
  const out: string[] = [];
  for (let n = first; n <= last; n++) {
    out.push(`${n === line ? '>' : ' '} ${String(n).padStart(width)} | ${lines[n - 1]}`);
    if (n === line) {
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, column - 1))}^`);
    }
  }
  return out.join('\n');
}

/** `src/app/app.html:12:5 - error TS2339: message`, the shape `tsc --pretty` prints. */
export function formatDiagnostic(d: Diagnostic, root: string): string {
  const where = d.file ? `${relativeTo(root, d.file)}${d.line ? `:${d.line}:${d.column}` : ''} - ` : '';
  return `${where}error ${d.code}: ${d.message}`;
}

function relativeTo(root: string, file: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return file.startsWith(base) ? file.slice(base.length) : file;
}
