import {ConsoleLogger, LogLevel, NodeJSFileSystem, type AbsoluteFsPath} from '@angular/compiler-cli';
import {FileLinker, LinkerEnvironment, type DeclarationScope} from '@angular/compiler-cli/linker';
import MagicString from 'magic-string';
import {parseSync} from 'vite';
import {OxcAstHost, StringAstFactory, type Expression, type Node} from './linker-oxc.js';

/**
 * Angular libraries ship partially compiled: `ɵɵngDeclareComponent(...)` and friends describe a
 * declaration without being its runtime code. The linker turns those calls into the final
 * `ɵɵdefineComponent(...)` code for the installed Angular version, as the CLI does for every
 * library in `node_modules`. ngp only compiles the app's own sources, so this is the plugin's job.
 *
 * The linking itself is Angular's `FileLinker`, from the public `@angular/compiler-cli/linker`
 * entry point. It reads each declaration through the oxc host in `linker-oxc.ts` and gets its
 * output back as a string, which replaces the call in place through magic-string. The module is
 * parsed once, with the oxc parser Vite ships, and never printed: a linked module is the original
 * text with each `ɵɵngDeclare` call swapped for its definition. That's the CLI's current design
 * (angular/angular-cli#33625), ported here because it's private to `@angular/build`.
 */
export const LINKER_MARKER = 'ɵɵngDeclare';

/** Angular's compiler and core define the ɵɵngDeclare functions but never need linking. */
const NEVER_LINKED = /[\\/]@angular[\\/](?:compiler|core)[\\/]/;

/**
 * Keeps each declaration's constants, like its parsed template, in an IIFE around the definition
 * instead of hoisting them to module scope. The replacement then stays within the call's range,
 * and an unused component's constants disappear with it when the bundler drops the component.
 */
const INLINE_CONSTANTS: DeclarationScope<null, Expression> = {getConstantScopeRef: () => null};

const host = new OxcAstHost();
const fileSystem = new NodeJSFileSystem();
const logger = new ConsoleLogger(LogLevel.warn);

/** Links one library module. Returns null when it has nothing to link. */
export function link(code: string, id: string): {code: string; map: unknown} | null {
  const file = id.replace(/[?#].*$/, '');
  if (!code.includes(LINKER_MARKER) || NEVER_LINKED.test(file)) {
    return null;
  }
  const {program, errors} = parseSync(file, code, {lang: 'js', sourceType: 'module', preserveParens: true});
  if (errors.length > 0) {
    throw new Error(`${file}: ${errors[0]!.message}`);
  }
  const factory = new StringAstFactory(code);
  // Source maps are off: the linker's own mapping is for the Babel printer. The map comes from
  // magic-string below, and maps every byte outside the replaced calls.
  const environment = LinkerEnvironment.create<string, Expression, string>(fileSystem, logger, host, factory, {
    linkerJitMode: false,
    sourceMapping: false,
  });
  const linker = new FileLinker<null, string, Expression, string>(environment, file as AbsoluteFsPath, code);
  const source = new MagicString(code);

  visitCalls(program, (call) => {
    const callee = host.getSymbolName(call.callee);
    if (!callee || !linker.isPartialDeclaration(callee)) {
      return false;
    }
    let linked: Expression;
    try {
      linked = linker.linkPartialDeclaration(callee, host.parseArguments(call), INLINE_CONSTANTS);
    } catch (error) {
      throw new Error(`Failed to link ${callee} in ${file}: ${(error as Error).message}`, {cause: error});
    }
    source.overwrite(call.start, call.end, factory.render(linked));
    return true;
  });

  if (!source.hasChanged()) {
    return null;
  }
  return {code: source.toString(), map: source.generateMap({hires: 'boundary', source: file, includeContent: true})};
}

/**
 * Visits every call expression in source order. `visit` returns true when it replaced the call,
 * so its arguments aren't walked: a replaced range can't be edited again.
 */
function visitCalls(root: Node, visit: (call: Node) => boolean): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'CallExpression' && visit(node)) {
      continue;
    }
    const children: Node[] = [];
    for (const key in node) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'range') {
        continue;
      }
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === 'string') {
            children.push(item);
          }
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        children.push(value);
      }
    }
    // In reverse, so the stack pops them in source order.
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]!);
    }
  }
}
