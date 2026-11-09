import {FatalLinkerError, type AstHost, type LinkerEnvironment} from '@angular/compiler-cli/linker';

/**
 * Angular's linker core is parser-agnostic: `FileLinker` reads a partial declaration through an
 * `AstHost` and emits the linked code through an `AstFactory`. Angular only ships a Babel pair.
 * These two are a port of the oxc pair the CLI keeps in `@angular/build`'s private tree
 * (`src/tools/angular/linker/oxc-ast-host.js` and `string-ast-factory.js`, MIT), so the plugin
 * can link with Vite's own oxc parser and no Babel.
 *
 * The host reads oxc's ESTree nodes. The factory doesn't build nodes at all: every expression it
 * creates is a string of JavaScript, and an expression it is handed from the source is rendered by
 * slicing the original text at the node's range. That's what lets the linker's output drop into
 * place with magic-string, without printing a whole module.
 */

/** An oxc ESTree node. Typed loosely: the host only reads the fields it checks for. */
export interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
}

/** What the linker passes around: a node from the source, or code the factory produced. */
export type Expression = Node | string;

/** The `AstFactory` shape, as `LinkerEnvironment.create` expects it for these type arguments. */
type AstFactory = Parameters<typeof LinkerEnvironment.create<string, Expression, string>>[3];
type ObjectLiteralProperty = Parameters<AstFactory['createObjectLiteral']>[0][number];
type TemplateLiteral = Parameters<AstFactory['createTemplateLiteral']>[0];
type Parameter = Parameters<AstFactory['createFunctionDeclaration']>[1][number];
type LeadingComment = Parameters<AstFactory['attachComments']>[1][number];
type VariableDeclarationType = Parameters<AstFactory['createVariableDeclaration']>[2];
type BinaryOperator = Parameters<AstFactory['createBinaryExpression']>[1];
type UnaryOperator = Parameters<AstFactory['createUnaryExpression']>[0];
type SourceMapRange = Parameters<AstFactory['setSourceMapRange']>[1];
type Range = ReturnType<AstHost<Expression>['getRange']>;

function isNode(node: unknown): node is Node {
  return typeof node === 'object' && node !== null && 'type' in node;
}

function unwrapParentheses(node: Expression): Expression {
  while (isNode(node) && node.type === 'ParenthesizedExpression') {
    node = node.expression;
  }
  return node;
}

/** `!0` and `!1`, which minifiers write for `true` and `false`. */
function isMinifiedBooleanLiteral(node: Node): boolean {
  if (node.type !== 'UnaryExpression') {
    return false;
  }
  const arg = node.argument;
  return node.prefix === true && node.operator === '!' && arg.type === 'Literal' && typeof arg.value === 'number' && (arg.value === 0 || arg.value === 1);
}

/** Reads a partial declaration's metadata from oxc's ESTree nodes. */
export class OxcAstHost implements AstHost<Expression> {
  getSymbolName(node: Expression): string | null {
    node = unwrapParentheses(node);
    if (!isNode(node)) {
      return null;
    }
    if (node.type === 'Identifier') {
      return node.name;
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      return node.property.name;
    }
    return null;
  }

  isStringLiteral(node: Expression): boolean {
    node = unwrapParentheses(node);
    return isNode(node) && node.type === 'Literal' && typeof node.value === 'string';
  }

  parseStringLiteral(str: Expression): string {
    str = unwrapParentheses(str);
    if (!this.isStringLiteral(str)) {
      throw new FatalLinkerError(str, 'Unsupported syntax, expected a string literal.');
    }
    return (str as Node).value;
  }

  isNumericLiteral(node: Expression): boolean {
    node = unwrapParentheses(node);
    return isNode(node) && node.type === 'Literal' && typeof node.value === 'number';
  }

  parseNumericLiteral(num: Expression): number {
    num = unwrapParentheses(num);
    if (!this.isNumericLiteral(num)) {
      throw new FatalLinkerError(num, 'Unsupported syntax, expected a numeric literal.');
    }
    return (num as Node).value;
  }

  isBooleanLiteral(node: Expression): boolean {
    node = unwrapParentheses(node);
    if (!isNode(node)) {
      return false;
    }
    return (node.type === 'Literal' && typeof node.value === 'boolean') || isMinifiedBooleanLiteral(node);
  }

  parseBooleanLiteral(bool: Expression): boolean {
    bool = unwrapParentheses(bool);
    if (isNode(bool)) {
      if (bool.type === 'Literal' && typeof bool.value === 'boolean') {
        return bool.value;
      }
      if (isMinifiedBooleanLiteral(bool)) {
        return !bool.argument.value;
      }
    }
    throw new FatalLinkerError(bool, 'Unsupported syntax, expected a boolean literal.');
  }

  isNull(node: Expression): boolean {
    node = unwrapParentheses(node);
    return isNode(node) && node.type === 'Literal' && node.value === null;
  }

  isArrayLiteral(node: Expression): boolean {
    node = unwrapParentheses(node);
    return isNode(node) && node.type === 'ArrayExpression';
  }

  parseArrayLiteral(array: Expression): Expression[] {
    array = unwrapParentheses(array);
    if (!this.isArrayLiteral(array)) {
      throw new FatalLinkerError(array, 'Unsupported syntax, expected an array literal.');
    }
    const result: Expression[] = [];
    for (const element of (array as Node).elements as (Node | null)[]) {
      if (element === null) {
        throw new FatalLinkerError(array, 'Unsupported syntax, element in array not to be empty.');
      }
      const unwrapped = unwrapParentheses(element);
      if (isNode(unwrapped) && unwrapped.type === 'SpreadElement') {
        throw new FatalLinkerError(unwrapped, 'Unsupported syntax, element in array not to use spread syntax.');
      }
      result.push(unwrapped);
    }
    return result;
  }

  isObjectLiteral(node: Expression): boolean {
    node = unwrapParentheses(node);
    return isNode(node) && node.type === 'ObjectExpression';
  }

  parseObjectLiteral(obj: Expression): Map<string, Expression> {
    obj = unwrapParentheses(obj);
    if (!this.isObjectLiteral(obj)) {
      throw new FatalLinkerError(obj, 'Unsupported syntax, expected an object literal.');
    }
    const result = new Map<string, Expression>();
    for (const property of (obj as Node).properties as Node[]) {
      if (property.type !== 'Property') {
        throw new FatalLinkerError(property, 'Unsupported syntax, expected a property assignment.');
      }
      const keyNode = unwrapParentheses(property.key);
      if (!isNode(keyNode)) {
        throw new FatalLinkerError(property.key, 'Unsupported syntax, expected a property name.');
      }
      let key: string;
      if (keyNode.type === 'Identifier') {
        key = keyNode.name;
      } else if (this.isStringLiteral(keyNode)) {
        key = keyNode.value;
      } else if (this.isNumericLiteral(keyNode)) {
        key = String(keyNode.value);
      } else {
        throw new FatalLinkerError(keyNode, 'Unsupported syntax, expected a property name.');
      }
      result.set(key, unwrapParentheses(property.value));
    }
    return result;
  }

  isFunctionExpression(node: Expression): boolean {
    node = unwrapParentheses(node);
    if (!isNode(node)) {
      return false;
    }
    return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
  }

  parseReturnValue(fn: Expression): Expression {
    fn = unwrapParentheses(fn);
    if (!this.isFunctionExpression(fn)) {
      throw new FatalLinkerError(fn, 'Unsupported syntax, expected a function.');
    }
    const body = (fn as Node).body;
    if (!body || !isNode(body)) {
      throw new FatalLinkerError(fn, 'Unsupported syntax, expected a function body.');
    }
    if (body.type !== 'BlockStatement') {
      return unwrapParentheses(body);
    }
    const statements = body.body as Node[];
    if (statements.length !== 1) {
      throw new FatalLinkerError(body, 'Unsupported syntax, expected a function body with a single return statement.');
    }
    const stmt = statements[0]!;
    if (stmt.type !== 'ReturnStatement') {
      throw new FatalLinkerError(stmt, 'Unsupported syntax, expected a function body with a single return statement.');
    }
    if (!stmt.argument) {
      throw new FatalLinkerError(stmt, 'Unsupported syntax, expected function to return a value.');
    }
    return unwrapParentheses(stmt.argument);
  }

  parseParameters(fn: Expression): Expression[] {
    fn = unwrapParentheses(fn);
    if (!this.isFunctionExpression(fn)) {
      throw new FatalLinkerError(fn, 'Unsupported syntax, expected a function.');
    }
    return (fn as Node).params;
  }

  isCallExpression(node: Expression): boolean {
    node = unwrapParentheses(node);
    return isNode(node) && node.type === 'CallExpression';
  }

  parseCallee(call: Expression): Expression {
    call = unwrapParentheses(call);
    if (!this.isCallExpression(call)) {
      throw new FatalLinkerError(call, 'Unsupported syntax, expected a call expression.');
    }
    return unwrapParentheses((call as Node).callee);
  }

  parseArguments(call: Expression): Expression[] {
    call = unwrapParentheses(call);
    if (!this.isCallExpression(call)) {
      throw new FatalLinkerError(call, 'Unsupported syntax, expected a call expression.');
    }
    const result: Expression[] = [];
    for (const arg of (call as Node).arguments as Node[]) {
      const unwrapped = unwrapParentheses(arg);
      if (isNode(unwrapped) && unwrapped.type === 'SpreadElement') {
        throw new FatalLinkerError(unwrapped, 'Unsupported syntax, argument not to use spread syntax.');
      }
      result.push(unwrapped);
    }
    return result;
  }

  getRange(node: Expression): Range {
    node = unwrapParentheses(node);
    if (!isNode(node) || typeof node.start !== 'number' || typeof node.end !== 'number') {
      throw new FatalLinkerError(node, 'Unable to read range for node - it is missing location information.');
    }
    // Line and column are only for source maps, which the plugin doesn't ask the linker for.
    return {startPos: node.start, startLine: 0, startCol: 0, endPos: node.end};
  }
}

/**
 * Marks a string the factory made with `createObjectLiteral`, so an arrow function whose body is
 * an object literal gets the parentheses it needs. Stripped by `render`.
 */
const OBJECT_LITERAL_PREFIX = '\0obj_';

/** Emits the linked code as strings. */
export class StringAstFactory implements AstFactory {
  constructor(private readonly sourceCode: string) {}

  /** The code for an expression: the factory's own string, or the source text under a node. */
  render(expr: Expression): string {
    let rendered: string;
    if (typeof expr === 'string') {
      rendered = expr;
    } else if (isNode(expr) && typeof expr.start === 'number' && typeof expr.end === 'number') {
      rendered = this.sourceCode.slice(expr.start, expr.end);
    } else {
      rendered = String(expr);
    }
    return rendered.startsWith(OBJECT_LITERAL_PREFIX) ? rendered.slice(OBJECT_LITERAL_PREFIX.length) : rendered;
  }

  /**
   * Parenthesizes an expression that can't stand as the receiver of a property access, element
   * access, call, `new` or tagged template: `(() => {}).foo`, `(5).foo`, `({a: 1}).foo`, `(void 0)()`.
   */
  private wrapReceiver(receiver: Expression): string {
    let rendered = this.render(receiver);
    if (
      rendered.startsWith('function') ||
      rendered.startsWith('{') ||
      rendered.includes('=>') ||
      /^(?:typeof|void|delete|new|await|throw|return)\b/.test(rendered) ||
      /^[!~+-]/.test(rendered) ||
      /^\d/.test(rendered)
    ) {
      rendered = `(${rendered})`;
    }
    return rendered;
  }

  /**
   * Parenthesizes an operand that isn't atomic or already parenthesized, so a binary, logical or
   * assignment expression keeps its precedence inside a larger one.
   */
  private wrapOperand(expr: Expression): string {
    const rendered = this.render(expr);
    if ((rendered.startsWith('(') && rendered.endsWith(')')) || /^[a-zA-Z0-9_$.[\]"'`]+$/.test(rendered)) {
      return rendered;
    }
    return `(${rendered})`;
  }

  /**
   * A no-op. The pure annotations that matter for tree-shaking come from `createCallExpression`
   * and `createCallChain` with `pure: true`. The compiler's other leading comments, `@ts-ignore`
   * and `webpackChunkName`, don't occur when linking a library's JavaScript.
   */
  attachComments(_statement: Expression, _leadingComments: LeadingComment[]): void {}

  createArrayLiteral(elements: Expression[]): Expression {
    return `[${elements.map((e) => this.render(e)).join(', ')}]`;
  }

  createAssignment(target: Expression, operator: BinaryOperator, value: Expression): Expression {
    return `(${this.render(target)} ${operator} ${this.render(value)})`;
  }

  createBinaryExpression(leftOperand: Expression, operator: BinaryOperator, rightOperand: Expression): Expression {
    return `(${this.wrapOperand(leftOperand)} ${operator} ${this.wrapOperand(rightOperand)})`;
  }

  createBlock(body: string[]): string {
    return `{\n${body.join('\n')}\n}`;
  }

  createCallExpression(callee: Expression, args: Expression[], pure: boolean): Expression {
    const annotation = pure ? '/*@__PURE__*/ ' : '';
    return `${annotation}${this.wrapReceiver(callee)}(${args.map((a) => this.render(a)).join(', ')})`;
  }

  createCallChain(callee: Expression, args: Expression[], pure: boolean, isOptional: boolean): Expression {
    const annotation = pure ? '/*@__PURE__*/ ' : '';
    const operator = isOptional ? '?.' : '';
    return `${annotation}${this.wrapReceiver(callee)}${operator}(${args.map((a) => this.render(a)).join(', ')})`;
  }

  createConditional(condition: Expression, thenExpression: Expression, elseExpression: Expression): Expression {
    return `(${this.render(condition)} ? ${this.render(thenExpression)} : ${this.render(elseExpression)})`;
  }

  createElementAccess(expression: Expression, element: Expression): Expression {
    return `${this.wrapReceiver(expression)}[${this.render(element)}]`;
  }

  createElementAccessChain(expression: Expression, element: Expression, isOptional: boolean): Expression {
    const operator = isOptional ? '?.' : '';
    return `${this.wrapReceiver(expression)}${operator}[${this.render(element)}]`;
  }

  createExpressionStatement(expression: Expression): string {
    return `${this.render(expression)};`;
  }

  createFunctionDeclaration(functionName: string, parameters: Parameter[], body: string): string {
    const params = parameters.map((p) => p.name).join(', ');
    return `function ${functionName}(${params}) ${body}`;
  }

  createFunctionExpression(functionName: string | null, parameters: Parameter[], body: string): Expression {
    const name = functionName ? ` ${functionName}` : '';
    const params = parameters.map((p) => p.name).join(', ');
    return `function${name}(${params}) ${body}`;
  }

  createArrowFunctionExpression(parameters: Parameter[], body: Expression): Expression {
    const params = parameters.map((p) => p.name).join(', ');
    const isObjectLiteral = typeof body === 'string' && body.startsWith(OBJECT_LITERAL_PREFIX);
    const rendered = this.render(body);
    return `(${params}) => ${isObjectLiteral ? `(${rendered})` : rendered}`;
  }

  createDynamicImport(url: string | Expression): Expression {
    return `import(${this.render(url)})`;
  }

  createIdentifier(name: string): Expression {
    return name;
  }

  createIfStatement(condition: Expression, thenStatement: string, elseStatement: string | null): string {
    const elseClause = elseStatement ? ` else ${elseStatement}` : '';
    return `if (${this.render(condition)}) ${thenStatement}${elseClause}`;
  }

  createLiteral(value: string | number | boolean | null | undefined): Expression {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
  }

  createNewExpression(expression: Expression, args: Expression[]): Expression {
    return `new ${this.wrapReceiver(expression)}(${args.map((a) => this.render(a)).join(', ')})`;
  }

  createObjectLiteral(properties: ObjectLiteralProperty[]): Expression {
    const props = properties.map((p) => {
      if (p.kind === 'spread') {
        return `...${this.render(p.expression)}`;
      }
      const key = p.quoted ? JSON.stringify(p.propertyName) : p.propertyName;
      return `${key}: ${this.render(p.value)}`;
    });
    return `${OBJECT_LITERAL_PREFIX}{\n${props.join(',\n')}\n}`;
  }

  createParenthesizedExpression(expression: Expression): Expression {
    return `(${this.render(expression)})`;
  }

  createPropertyAccess(expression: Expression, propertyName: string): Expression {
    return `${this.wrapReceiver(expression)}.${propertyName}`;
  }

  createPropertyAccessChain(expression: Expression, propertyName: string, isOptional: boolean): Expression {
    const operator = isOptional ? '?.' : '.';
    return `${this.wrapReceiver(expression)}${operator}${propertyName}`;
  }

  createReturnStatement(expression: Expression | null): string {
    return `return${expression !== null ? ` ${this.render(expression)}` : ''};`;
  }

  createTaggedTemplate(tag: Expression, template: TemplateLiteral): Expression {
    return `${this.wrapReceiver(tag)}${this.createTemplateLiteral(template)}`;
  }

  createTemplateLiteral(template: TemplateLiteral): string {
    let result = '`';
    for (let i = 0; i < template.elements.length; i++) {
      result += template.elements[i]!.raw;
      if (i < template.expressions.length) {
        result += `\${${this.render(template.expressions[i]!)}}`;
      }
    }
    return result + '`';
  }

  createThrowStatement(expression: Expression): string {
    return `throw ${this.render(expression)};`;
  }

  createTypeOfExpression(expression: Expression): Expression {
    return `typeof ${this.wrapOperand(expression)}`;
  }

  createVoidExpression(expression: Expression): Expression {
    return `void ${this.wrapOperand(expression)}`;
  }

  createUnaryExpression(operator: UnaryOperator, operand: Expression): Expression {
    return `${operator}${this.wrapOperand(operand)}`;
  }

  createVariableDeclaration(variableName: string, initializer: Expression | null, variableType: VariableDeclarationType): string {
    const init = initializer !== null ? ` = ${this.render(initializer)}` : '';
    return `${variableType} ${variableName}${init};`;
  }

  createRegularExpressionLiteral(body: string, flags: string | null): Expression {
    return `/${body}/${flags ?? ''}`;
  }

  createSpreadElement(expression: Expression): Expression {
    return `...${this.render(expression)}`;
  }

  // Types never appear in linked JavaScript.
  createBuiltInType(): string {
    return '';
  }

  createExpressionType(): string {
    return '';
  }

  createArrayType(): string {
    return '';
  }

  createMapType(): string {
    return '';
  }

  transplantType(): string {
    return '';
  }

  setSourceMapRange<T extends Expression>(node: T, _sourceMapRange: SourceMapRange | null): T {
    return node;
  }
}
