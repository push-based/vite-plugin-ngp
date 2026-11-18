import type * as TS from 'typescript';
import {ts} from './typescript.js';

/**
 * Decorator fields whose edits a component update module can apply in place. The CLI also accepts
 * `templateUrl`, `styleUrl` and `styleUrls` here. This plugin doesn't yet, because pointing a
 * component at a different file hasn't been tested with ngp's analyzer.
 */
const HMR_FIELDS = new Set(['template', 'styles']);

/**
 * Compares a `.ts` file before and after an edit, and decides whether the components it declares
 * can be updated in place. Resolves to the names of the component classes whose inline `template`
 * or `styles` changed, or to null when anything else changed, which needs a page reload.
 *
 * A port of `analyzeFileUpdates` in @angular/build (`hmr-candidates.ts`), with the same rules: the
 * files must have the same top-level statements, and every statement must be textually identical,
 * leading comments included, except inside the single decorator of a component class. There, only
 * the values of `template` and `styles` may differ, and adding or removing either counts as a
 * change. An empty list means nothing a component depends on changed: only trailing trivia did.
 *
 * `isComponent` says which class names the analyzer knows as components. Everything else, plain
 * classes and other Angular decorators included, has to be unchanged.
 */
export function hmrCandidates(
  fileName: string,
  stale: string,
  updated: string,
  isComponent: (className: string) => boolean,
): string[] | null {
  const staleFile = ts.createSourceFile(fileName, stale, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const updatedFile = ts.createSourceFile(fileName, updated, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  if (staleFile.statements.length !== updatedFile.statements.length) {
    return null;
  }
  const same = (a: TS.TextRange | undefined, b: TS.TextRange | undefined) => equalText(staleFile, a, updatedFile, b);
  const candidates: string[] = [];
  for (let i = 0; i < updatedFile.statements.length; i++) {
    const before = staleFile.statements[i]!;
    const after = updatedFile.statements[i]!;
    const name = ts.isClassDeclaration(after) ? after.name?.text : undefined;
    if (!ts.isClassDeclaration(after) || !name || !isComponent(name) || !ts.isClassDeclaration(before)) {
      if (!same(before, after)) {
        return null;
      }
      continue;
    }
    // The class itself: name, heritage, modifiers and members.
    if (before.name?.text !== name || !same(before.heritageClauses, after.heritageClauses) || !same(before.members, after.members)) {
      return null;
    }
    const modifiers = (node: TS.ClassDeclaration) => (ts.getModifiers(node) ?? []).map((m) => m.kind).join();
    if (modifiers(before) !== modifiers(after)) {
      return null;
    }
    // Exactly one decorator, called with one object literal, under the same name.
    const beforeCall = componentCall(before);
    const afterCall = componentCall(after);
    if (!beforeCall || !afterCall || !same(beforeCall.call.expression, afterCall.call.expression)) {
      return null;
    }
    const change = compareFields(beforeCall.fields, afterCall.fields, same);
    if (change === 'unsupported') {
      return null;
    }
    if (change === 'changed') {
      candidates.push(name);
    }
  }
  return candidates;
}

function componentCall(node: TS.ClassDeclaration) {
  const decorators = ts.getDecorators(node) ?? [];
  // The CLI rejects every component with more than one decorator too.
  const call = decorators.length === 1 ? decorators[0]!.expression : undefined;
  if (!call || !ts.isCallExpression(call) || call.arguments.length !== 1) {
    return null;
  }
  const literal = call.arguments[0]!;
  if (!ts.isObjectLiteralExpression(literal)) {
    return null;
  }
  const fields: {name: string; value: TS.Expression}[] = [];
  for (const property of literal.properties) {
    // Shorthand, spread, methods and computed names hide what the value is.
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
      return null;
    }
    fields.push({name: property.name.text, value: property.initializer});
  }
  return {call, fields};
}

/**
 * 'changed' when a `template` or `styles` value was edited, added or removed, 'unchanged' when
 * nothing was, and 'unsupported' when any other field changed, moved, or was added or removed.
 */
function compareFields(
  before: {name: string; value: TS.Expression}[],
  after: {name: string; value: TS.Expression}[],
  same: (a: TS.TextRange | undefined, b: TS.TextRange | undefined) => boolean,
): 'changed' | 'unchanged' | 'unsupported' {
  const hmrBefore = new Map(before.filter((f) => HMR_FIELDS.has(f.name)).map((f) => [f.name, f.value]));
  const otherBefore = before.filter((f) => !HMR_FIELDS.has(f.name));
  const otherAfter = after.filter((f) => !HMR_FIELDS.has(f.name));
  if (otherBefore.length !== otherAfter.length) {
    return 'unsupported';
  }
  for (let i = 0; i < otherAfter.length; i++) {
    if (otherBefore[i]!.name !== otherAfter[i]!.name || !same(otherBefore[i]!.value, otherAfter[i]!.value)) {
      return 'unsupported';
    }
  }
  let changed = false;
  for (const field of after.filter((f) => HMR_FIELDS.has(f.name))) {
    changed ||= !same(hmrBefore.get(field.name), field.value);
    hmrBefore.delete(field.name);
  }
  // A field left over was removed.
  return changed || hmrBefore.size > 0 ? 'changed' : 'unchanged';
}

/** Compares two ranges' source text, leading trivia included, the way the CLI does. */
function equalText(a: TS.SourceFile, aRange: TS.TextRange | undefined, b: TS.SourceFile, bRange: TS.TextRange | undefined): boolean {
  if (!aRange || !bRange) {
    return aRange === bRange;
  }
  return a.text.slice(aRange.pos, aRange.end) === b.text.slice(bRange.pos, bRange.end);
}
