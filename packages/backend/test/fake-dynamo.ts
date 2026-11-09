/**
 * An in-memory stand-in for DynamoDB, used instead of DynamoDB Local (no docker in this environment).
 *
 * It sits behind the same `DynamoDBDocumentClient.send(command)` interface the repository uses and
 * understands the lib-dynamodb command objects (`PutCommand`, `GetCommand`, `UpdateCommand`,
 * `DeleteCommand`, `QueryCommand`, `BatchWriteCommand`) by reading `command.input` in native JS values
 * (numbers, strings, booleans, arrays, maps and `Set`s), exactly as lib-dynamodb receives them before
 * marshalling.
 *
 * What it emulates faithfully enough for the repository:
 * - the expression languages: ConditionExpression / KeyConditionExpression (AND, OR, NOT, parentheses,
 *   `= <> < <= > >=`, `attribute_exists`, `attribute_not_exists`, `begins_with`, `contains`, `size`) and
 *   UpdateExpression (`SET` with `+`, `-`, `if_not_exists`, `list_append`; `ADD` on numbers and sets;
 *   `REMOVE`; `DELETE` from sets), including nested document paths
 * - upsert-on-update, conditional failures (`ConditionalCheckFailedException`), `ReturnValues`
 *   (`NONE`, `ALL_OLD`, `ALL_NEW`) and `LastEvaluatedKey` pagination, `ScanIndexForward`, `Limit`
 * - the validation errors that catch real bugs: undefined values, NaN / Infinity, empty sets, unused or
 *   missing `#name` / `:value` placeholders, unaliased reserved words, overlapping update paths
 *   (`ADD x` with `DELETE x` in one call), writes to key attributes, missing key attributes
 * - an optional IAM-style allow-list of operations so a test can prove a handler never calls an API its
 *   role lacks (the ingest role has no DeleteItem or BatchWriteItem)
 *
 * What it does NOT emulate (all real behaviour, none exercised by these tests):
 * - provisioned capacity and throttling (`ProvisionedThroughputExceededException`), consumed-capacity
 *   accounting, and the SDK's retry behaviour
 * - TTL deletion in the background: expired items stay readable until `expireTtl(nowSeconds)` is called
 * - eventual consistency (every read is strongly consistent), the 1 MB page limit on Query and the
 *   400 KB item size limit
 * - transactions, streams, `Scan`, `BatchGetItem`, filter and projection expressions, `IN` and `BETWEEN`
 * - GSI propagation delay (the GSI is a view computed at query time and always projects ALL)
 * - DynamoDB's 38-digit decimal numbers (JS doubles are used), binary and NULL types, and the full
 *   reserved-word list (a representative subset is checked)
 * - the exact wording of error messages
 */
import {
  ConditionalCheckFailedException,
  DynamoDBServiceException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export type Item = Record<string, unknown>;

/** The union of the output fields the supported commands return. */
export interface FakeOutput {
  Item?: Item;
  Items?: Item[];
  Attributes?: Item;
  Count?: number;
  LastEvaluatedKey?: Item;
  UnprocessedItems?: Record<string, unknown>;
}

export type FakeOperation =
  'PutItem' | 'GetItem' | 'UpdateItem' | 'DeleteItem' | 'Query' | 'BatchWriteItem';

export interface FakeDynamoOptions {
  tableName?: string;
  /** Operations the "role" may call; any other throws AccessDeniedException. Default: all. */
  allowedOperations?: readonly FakeOperation[];
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

function serviceError(name: string, message: string): DynamoDBServiceException {
  return new DynamoDBServiceException({ name, $fault: 'client', $metadata: {}, message });
}

function validation(message: string): DynamoDBServiceException {
  return serviceError('ValidationException', message);
}

function conditionFailed(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Item {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Set)
  );
}

/** Reject anything lib-dynamodb's marshaller would reject (or silently corrupt). */
function validateValue(value: unknown, where: string): void {
  if (value === undefined) {
    throw validation(`Undefined value at ${where} (the marshaller rejects undefined)`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw validation(`Non-finite number at ${where}`);
    }
    return;
  }
  if (value instanceof Set) {
    if (value.size === 0) {
      throw validation(`Empty set at ${where}`);
    }
    const kinds = new Set([...value].map((entry) => typeof entry));
    if (kinds.size !== 1 || (!kinds.has('number') && !kinds.has('string'))) {
      throw validation(`Set at ${where} must hold only numbers or only strings`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateValue(entry, `${where}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      validateValue(entry, `${where}.${key}`);
    }
    return;
  }
  throw validation(`Unsupported value of type ${typeof value} at ${where}`);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Set && b instanceof Set) {
    return a.size === b.size && [...a].every((entry) => b.has(entry));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => deepEqual(entry, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    return (
      keysA.length === Object.keys(b).length &&
      keysA.every((key) => key in b && deepEqual(a[key], b[key]))
    );
  }
  return a === b;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------------------------
// Expression tokenizer and parser
// ---------------------------------------------------------------------------------------------

interface Token {
  type: 'name' | 'value' | 'word' | 'punct';
  text: string;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s*(?:(#[A-Za-z0-9_]+)|(:[A-Za-z0-9_]+)|([A-Za-z_][A-Za-z0-9_]*)|(<>|<=|>=|[=<>(),.+-]))/y;
  let position = 0;
  while (position < expression.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(expression);
    if (!match) {
      if (expression.slice(position).trim() === '') {
        break;
      }
      throw validation(
        `Syntax error in expression near "${expression.slice(position, position + 12)}"`,
      );
    }
    position = pattern.lastIndex;
    if (match[1] !== undefined) {
      tokens.push({ type: 'name', text: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'value', text: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'word', text: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'punct', text: match[4] });
    }
  }
  return tokens;
}

/** A representative subset of DynamoDB's reserved words (the real list has ~570). */
const RESERVED_WORDS = new Set(
  [
    'ADD',
    'ALL',
    'AND',
    'AS',
    'ASC',
    'BY',
    'COMMENT',
    'CONDITION',
    'COUNT',
    'CREATE',
    'DATA',
    'DATE',
    'DAY',
    'DELETE',
    'DESC',
    'ELSE',
    'END',
    'EXISTS',
    'FILTER',
    'FOR',
    'FROM',
    'GROUP',
    'IF',
    'IN',
    'INDEX',
    'INSERT',
    'IS',
    'KEY',
    'KEYS',
    'LEVEL',
    'LIMIT',
    'LIST',
    'MAP',
    'NAME',
    'NOT',
    'NULL',
    'NUMBER',
    'OR',
    'ORDER',
    'OWNER',
    'REMOVE',
    'SET',
    'SIZE',
    'STATE',
    'STATUS',
    'STRING',
    'TABLE',
    'TIME',
    'TIMESTAMP',
    'TOKEN',
    'TTL',
    'TYPE',
    'UPDATE',
    'USER',
    'USERS',
    'VALUE',
    'VALUES',
    'VIEW',
    'WHERE',
    'YEAR',
    'ZONE',
  ].map((word) => word.toUpperCase()),
);

interface ExpressionContext {
  names: Record<string, string>;
  values: Record<string, unknown>;
  usedNames: Set<string>;
  usedValues: Set<string>;
}

function createContext(
  names: Record<string, string> | undefined,
  values: Record<string, unknown> | undefined,
): ExpressionContext {
  for (const [placeholder, value] of Object.entries(values ?? {})) {
    if (!placeholder.startsWith(':')) {
      throw validation(`ExpressionAttributeValues key ${placeholder} must start with ":"`);
    }
    validateValue(value, `ExpressionAttributeValues.${placeholder}`);
  }
  for (const placeholder of Object.keys(names ?? {})) {
    if (!placeholder.startsWith('#')) {
      throw validation(`ExpressionAttributeNames key ${placeholder} must start with "#"`);
    }
  }
  return { names: names ?? {}, values: values ?? {}, usedNames: new Set(), usedValues: new Set() };
}

function assertAllUsed(context: ExpressionContext): void {
  for (const placeholder of Object.keys(context.names)) {
    if (!context.usedNames.has(placeholder)) {
      throw validation(`ExpressionAttributeNames contains unused key ${placeholder}`);
    }
  }
  for (const placeholder of Object.keys(context.values)) {
    if (!context.usedValues.has(placeholder)) {
      throw validation(`ExpressionAttributeValues contains unused key ${placeholder}`);
    }
  }
}

type Path = string[];

type Operand =
  | { type: 'path'; path: Path }
  | { type: 'value'; ref: string }
  | { type: 'call'; name: 'size' | 'if_not_exists' | 'list_append'; args: Operand[] }
  | { type: 'math'; op: '+' | '-'; left: Operand; right: Operand };

type Condition =
  | { type: 'and' | 'or'; left: Condition; right: Condition }
  | { type: 'not'; inner: Condition }
  | { type: 'compare'; op: '=' | '<>' | '<' | '<=' | '>' | '>='; left: Operand; right: Operand }
  | { type: 'function'; name: string; args: Operand[] };

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: ExpressionContext,
  ) {}

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(): Token | undefined {
    return this.tokens[this.position];
  }

  peekWord(): string | undefined {
    const token = this.peek();
    return token?.type === 'word' ? token.text.toUpperCase() : undefined;
  }

  next(): Token {
    const token = this.tokens[this.position];
    if (!token) {
      throw validation('Syntax error: unexpected end of expression');
    }
    this.position += 1;
    return token;
  }

  acceptPunct(text: string): boolean {
    const token = this.peek();
    if (token?.type === 'punct' && token.text === text) {
      this.position += 1;
      return true;
    }
    return false;
  }

  expectPunct(text: string): void {
    if (!this.acceptPunct(text)) {
      throw validation(`Syntax error: expected "${text}"`);
    }
  }

  acceptWord(word: string): boolean {
    if (this.peekWord() === word) {
      this.position += 1;
      return true;
    }
    return false;
  }

  // ----- paths and operands -----

  private segment(): string {
    const token = this.next();
    if (token.type === 'name') {
      const resolved = this.context.names[token.text];
      if (resolved === undefined) {
        throw validation(
          `An expression attribute name used in the expression is not defined: ${token.text}`,
        );
      }
      this.context.usedNames.add(token.text);
      return resolved;
    }
    if (token.type === 'word') {
      if (RESERVED_WORDS.has(token.text.toUpperCase())) {
        throw validation(`Attribute name is a reserved keyword; reserved keyword: ${token.text}`);
      }
      return token.text;
    }
    throw validation(`Syntax error: expected an attribute name near "${token.text}"`);
  }

  path(): Path {
    const segments = [this.segment()];
    while (this.acceptPunct('.')) {
      segments.push(this.segment());
    }
    return segments;
  }

  private callArgs(): Operand[] {
    this.expectPunct('(');
    const args: Operand[] = [this.operand()];
    while (this.acceptPunct(',')) {
      args.push(this.operand());
    }
    this.expectPunct(')');
    return args;
  }

  /** A path, a value placeholder, or `size` / `if_not_exists` / `list_append` calls. */
  baseOperand(): Operand {
    const token = this.peek();
    if (!token) {
      throw validation('Syntax error: expected an operand');
    }
    if (token.type === 'value') {
      this.position += 1;
      if (!(token.text in this.context.values)) {
        throw validation(
          `An expression attribute value used in expression is not defined: ${token.text}`,
        );
      }
      this.context.usedValues.add(token.text);
      return { type: 'value', ref: token.text };
    }
    if (token.type === 'word') {
      const lower = token.text.toLowerCase();
      if (lower === 'size' || lower === 'if_not_exists' || lower === 'list_append') {
        this.position += 1;
        return { type: 'call', name: lower, args: this.callArgs() };
      }
    }
    return { type: 'path', path: this.path() };
  }

  /** Operand with optional trailing `+ operand` / `- operand` (SET right-hand sides only). */
  operand(): Operand {
    return this.baseOperand();
  }

  setOperand(): Operand {
    const left = this.baseOperand();
    if (this.acceptPunct('+')) {
      return { type: 'math', op: '+', left, right: this.baseOperand() };
    }
    if (this.acceptPunct('-')) {
      return { type: 'math', op: '-', left, right: this.baseOperand() };
    }
    return left;
  }

  // ----- conditions -----

  condition(): Condition {
    let left = this.andCondition();
    while (this.acceptWord('OR')) {
      left = { type: 'or', left, right: this.andCondition() };
    }
    return left;
  }

  private andCondition(): Condition {
    let left = this.notCondition();
    while (this.acceptWord('AND')) {
      left = { type: 'and', left, right: this.notCondition() };
    }
    return left;
  }

  private notCondition(): Condition {
    if (this.acceptWord('NOT')) {
      return { type: 'not', inner: this.notCondition() };
    }
    return this.primaryCondition();
  }

  private primaryCondition(): Condition {
    if (this.acceptPunct('(')) {
      const inner = this.condition();
      this.expectPunct(')');
      return inner;
    }
    const token = this.peek();
    if (token?.type === 'word') {
      const lower = token.text.toLowerCase();
      if (
        lower === 'attribute_exists' ||
        lower === 'attribute_not_exists' ||
        lower === 'begins_with' ||
        lower === 'contains'
      ) {
        this.position += 1;
        return { type: 'function', name: lower, args: this.callArgs() };
      }
    }
    const left = this.operand();
    const comparator = this.next();
    if (
      comparator.type !== 'punct' ||
      !['=', '<>', '<', '<=', '>', '>='].includes(comparator.text)
    ) {
      throw validation(`Syntax error: expected a comparison operator near "${comparator.text}"`);
    }
    const right = this.operand();
    return {
      type: 'compare',
      op: comparator.text as '=' | '<>' | '<' | '<=' | '>' | '>=',
      left,
      right,
    };
  }
}

function parseCondition(expression: string, context: ExpressionContext): Condition {
  const parser = new Parser(tokenize(expression), context);
  const condition = parser.condition();
  if (!parser.atEnd()) {
    throw validation('Syntax error: unexpected trailing tokens in condition');
  }
  return condition;
}

// ----- evaluation -----

function readPath(item: Item, path: Path): unknown {
  let current: unknown = item;
  for (const segment of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function evaluateOperand(operand: Operand, item: Item, context: ExpressionContext): unknown {
  switch (operand.type) {
    case 'path':
      return readPath(item, operand.path);
    case 'value':
      return context.values[operand.ref];
    case 'call': {
      const [first, second] = operand.args.map((arg) => evaluateOperand(arg, item, context));
      if (operand.name === 'size') {
        if (typeof first === 'string' || Array.isArray(first)) {
          return first.length;
        }
        if (first instanceof Set) {
          return first.size;
        }
        return isPlainObject(first) ? Object.keys(first).length : undefined;
      }
      if (operand.name === 'if_not_exists') {
        return first === undefined ? second : first;
      }
      if (!Array.isArray(first) || !Array.isArray(second)) {
        throw validation('list_append requires two lists');
      }
      return [...first, ...second];
    }
    case 'math': {
      const left = evaluateOperand(operand.left, item, context);
      const right = evaluateOperand(operand.right, item, context);
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw validation('An operand in the update expression has an incorrect data type');
      }
      return operand.op === '+' ? left + right : left - right;
    }
  }
}

function compare(op: string, left: unknown, right: unknown): boolean {
  if (op === '=') {
    return left !== undefined && right !== undefined && deepEqual(left, right);
  }
  if (op === '<>') {
    // A missing attribute is "not equal" to anything.
    return left === undefined || right === undefined || !deepEqual(left, right);
  }
  const comparable =
    (typeof left === 'number' && typeof right === 'number') ||
    (typeof left === 'string' && typeof right === 'string');
  if (!comparable) {
    return false;
  }
  const a = left as number | string;
  const b = right as number | string;
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

function evaluateCondition(condition: Condition, item: Item, context: ExpressionContext): boolean {
  switch (condition.type) {
    case 'and':
      return (
        evaluateCondition(condition.left, item, context) &&
        evaluateCondition(condition.right, item, context)
      );
    case 'or':
      return (
        evaluateCondition(condition.left, item, context) ||
        evaluateCondition(condition.right, item, context)
      );
    case 'not':
      return !evaluateCondition(condition.inner, item, context);
    case 'compare':
      return compare(
        condition.op,
        evaluateOperand(condition.left, item, context),
        evaluateOperand(condition.right, item, context),
      );
    case 'function': {
      const values = condition.args.map((arg) => evaluateOperand(arg, item, context));
      switch (condition.name) {
        case 'attribute_exists':
          return values[0] !== undefined;
        case 'attribute_not_exists':
          return values[0] === undefined;
        case 'begins_with':
          return (
            typeof values[0] === 'string' &&
            typeof values[1] === 'string' &&
            values[0].startsWith(values[1])
          );
        default: {
          const [container, needle] = values;
          if (typeof container === 'string' && typeof needle === 'string') {
            return container.includes(needle);
          }
          if (container instanceof Set) {
            return container.has(needle);
          }
          return Array.isArray(container) && container.some((entry) => deepEqual(entry, needle));
        }
      }
    }
  }
}

// ----- update expressions -----

interface UpdateActions {
  set: { path: Path; value: Operand }[];
  add: { path: Path; value: Operand }[];
  remove: Path[];
  delete: { path: Path; value: Operand }[];
}

function parseUpdate(expression: string, context: ExpressionContext): UpdateActions {
  const parser = new Parser(tokenize(expression), context);
  const actions: UpdateActions = { set: [], add: [], remove: [], delete: [] };
  const seen = new Set<string>();
  while (!parser.atEnd()) {
    const keyword = parser.peekWord();
    if (keyword !== 'SET' && keyword !== 'ADD' && keyword !== 'REMOVE' && keyword !== 'DELETE') {
      throw validation('Syntax error: expected SET, ADD, REMOVE or DELETE');
    }
    if (seen.has(keyword)) {
      throw validation(`The "${keyword}" section can only be used once in an update expression`);
    }
    seen.add(keyword);
    parser.next();
    do {
      const path = parser.path();
      if (keyword === 'SET') {
        parser.expectPunct('=');
        actions.set.push({ path, value: parser.setOperand() });
      } else if (keyword === 'ADD') {
        actions.add.push({ path, value: parser.operand() });
      } else if (keyword === 'DELETE') {
        actions.delete.push({ path, value: parser.operand() });
      } else {
        actions.remove.push(path);
      }
    } while (parser.acceptPunct(','));
  }
  const all = [
    ...actions.set.map((action) => action.path),
    ...actions.add.map((action) => action.path),
    ...actions.delete.map((action) => action.path),
    ...actions.remove,
  ];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i] ?? [];
      const b = all[j] ?? [];
      const shorter = Math.min(a.length, b.length);
      if (a.slice(0, shorter).join('\u0000') === b.slice(0, shorter).join('\u0000')) {
        throw validation(
          `Two document paths overlap with each other: ${a.join('.')} and ${b.join('.')}`,
        );
      }
    }
  }
  return actions;
}

function parentOf(item: Item, path: Path): { parent: Item; key: string } {
  let current: Item = item;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    if (!isPlainObject(next)) {
      throw validation('The document path provided in the update expression is invalid for update');
    }
    current = next;
  }
  const key = path[path.length - 1];
  if (key === undefined) {
    throw validation('Empty document path');
  }
  return { parent: current, key };
}

function applyUpdate(
  original: Item,
  actions: UpdateActions,
  context: ExpressionContext,
  keyAttributes: readonly string[],
): Item {
  const next = clone(original);
  for (const path of [
    ...actions.set.map((action) => action.path),
    ...actions.add.map((action) => action.path),
    ...actions.delete.map((action) => action.path),
    ...actions.remove,
  ]) {
    if (path.length === 1 && keyAttributes.includes(path[0] ?? '')) {
      throw validation(
        `One or more parameter values were invalid: Cannot update attribute ${path[0]}. This attribute is part of the key`,
      );
    }
  }
  // Every right-hand side is evaluated against the item as it was before the update.
  const sets = actions.set.map((action) => ({
    path: action.path,
    value: evaluateOperand(action.value, original, context),
  }));
  for (const { path, value } of sets) {
    if (value === undefined) {
      throw validation(
        'The provided expression refers to an attribute that does not exist in the item',
      );
    }
    const { parent, key } = parentOf(next, path);
    parent[key] = clone(value);
  }
  for (const action of actions.add) {
    const amount = evaluateOperand(action.value, original, context);
    const { parent, key } = parentOf(next, action.path);
    const existing = parent[key];
    if (typeof amount === 'number') {
      if (existing !== undefined && typeof existing !== 'number') {
        throw validation('An operand in the update expression has an incorrect data type');
      }
      parent[key] = (existing ?? 0) + amount;
    } else if (amount instanceof Set) {
      if (existing !== undefined && !(existing instanceof Set)) {
        throw validation('An operand in the update expression has an incorrect data type');
      }
      parent[key] = new Set([...(existing instanceof Set ? existing : []), ...amount]);
    } else {
      throw validation('ADD supports only numbers and sets');
    }
  }
  for (const action of actions.delete) {
    const removal = evaluateOperand(action.value, original, context);
    const { parent, key } = parentOf(next, action.path);
    const existing = parent[key];
    if (!(removal instanceof Set) || (existing !== undefined && !(existing instanceof Set))) {
      throw validation('DELETE supports only sets');
    }
    if (existing instanceof Set) {
      const remaining = new Set([...existing].filter((entry) => !removal.has(entry)));
      if (remaining.size === 0) {
        delete parent[key];
      } else {
        parent[key] = remaining;
      }
    }
  }
  for (const path of actions.remove) {
    const { parent, key } = parentOf(next, path);
    delete parent[key];
  }
  validateValue(next, 'item');
  return next;
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

const KEY_ATTRIBUTES = ['PK', 'SK'] as const;
const INDEX_ATTRIBUTES = ['GSI1PK', 'GSI1SK'] as const;
const MAX_BATCH = 25;

interface CommandLike {
  input: Record<string, unknown>;
}

export class FakeDynamo {
  private readonly table: string;
  private readonly allowed: ReadonlySet<FakeOperation> | null;
  private readonly store = new Map<string, Item>();

  /** Every call received, in order (operation name and the raw input). */
  readonly calls: { operation: FakeOperation; input: Record<string, unknown> }[] = [];

  constructor(options: FakeDynamoOptions = {}) {
    this.table = options.tableName ?? 'mergescape';
    this.allowed = options.allowedOperations ? new Set(options.allowedOperations) : null;
  }

  // ----- test helpers -----

  /** Number of write API calls received (Put, Update, Delete, BatchWrite), successful or not. */
  get writeCalls(): number {
    return this.calls.filter((call) =>
      ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem'].includes(call.operation),
    ).length;
  }

  /** A copy of every stored item. */
  snapshot(): Item[] {
    return [...this.store.values()].map((item) => clone(item));
  }

  /** A copy of one stored item, or undefined. */
  peek(pk: string, sk: string): Item | undefined {
    const item = this.store.get(this.storeKey(pk, sk));
    return item ? clone(item) : undefined;
  }

  get size(): number {
    return this.store.size;
  }

  /** Simulate DynamoDB's background TTL sweep: delete every item whose `ttl` is at or before `nowSeconds`. */
  expireTtl(nowSeconds: number): number {
    let removed = 0;
    for (const [key, item] of this.store) {
      if (typeof item.ttl === 'number' && item.ttl <= nowSeconds) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  // ----- client interface -----

  /** The `DynamoDBDocumentClient.send` surface used by the repository. */
  send(command: unknown): Promise<FakeOutput> {
    try {
      return Promise.resolve(this.dispatch(command));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private dispatch(command: unknown): FakeOutput {
    const input = (command as CommandLike).input;
    if (command instanceof PutCommand) {
      return this.guard('PutItem', input, () => this.put(input));
    }
    if (command instanceof GetCommand) {
      return this.guard('GetItem', input, () => this.get(input));
    }
    if (command instanceof UpdateCommand) {
      return this.guard('UpdateItem', input, () => this.update(input));
    }
    if (command instanceof DeleteCommand) {
      return this.guard('DeleteItem', input, () => this.delete(input));
    }
    if (command instanceof QueryCommand) {
      return this.guard('Query', input, () => this.query(input));
    }
    if (command instanceof BatchWriteCommand) {
      return this.guard('BatchWriteItem', input, () => this.batchWrite(input));
    }
    throw serviceError('UnsupportedOperation', 'The fake DynamoDB does not implement this command');
  }

  private guard(
    operation: FakeOperation,
    input: Record<string, unknown>,
    run: () => FakeOutput,
  ): FakeOutput {
    this.calls.push({ operation, input: clone(input) });
    if (this.allowed && !this.allowed.has(operation)) {
      throw serviceError(
        'AccessDeniedException',
        `User is not authorized to perform: dynamodb:${operation} on the table`,
      );
    }
    return run();
  }

  // ----- keys and items -----

  private storeKey(pk: string, sk: string): string {
    return `${pk}\u0000${sk}`;
  }

  private checkTable(input: Record<string, unknown>): void {
    if (input.TableName !== this.table) {
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
        $metadata: {},
      });
    }
  }

  private keyOf(source: unknown, what: string): { pk: string; sk: string } {
    if (!isPlainObject(source)) {
      throw validation(`The ${what} is missing`);
    }
    const { PK, SK } = source;
    if (typeof PK !== 'string' || PK === '' || typeof SK !== 'string' || SK === '') {
      throw validation(
        `One or more parameter values are not valid: the ${what} must have non-empty string PK and SK`,
      );
    }
    return { pk: PK, sk: SK };
  }

  private exactKey(source: unknown): { pk: string; sk: string } {
    const key = this.keyOf(source, 'key');
    if (Object.keys(source as Item).length !== 2) {
      throw validation('The provided key element does not match the schema');
    }
    return key;
  }

  private checkCondition(
    expression: unknown,
    names: unknown,
    values: unknown,
    existing: Item | undefined,
  ): void {
    if (expression === undefined) {
      if (names !== undefined || values !== undefined) {
        throw validation('ExpressionAttributeNames / Values provided without an expression');
      }
      return;
    }
    const context = createContext(
      names as Record<string, string> | undefined,
      values as Record<string, unknown> | undefined,
    );
    const condition = parseCondition(String(expression), context);
    assertAllUsed(context);
    if (!evaluateCondition(condition, existing ?? {}, context)) {
      throw conditionFailed();
    }
  }

  // ----- operations -----

  private put(input: Record<string, unknown>): FakeOutput {
    this.checkTable(input);
    const itemInput = input.Item;
    if (!isPlainObject(itemInput)) {
      throw validation('Item is required');
    }
    validateValue(itemInput, 'Item');
    const { pk, sk } = this.keyOf(itemInput, 'item');
    const existing = this.store.get(this.storeKey(pk, sk));
    this.checkCondition(
      input.ConditionExpression,
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues,
      existing,
    );
    this.store.set(this.storeKey(pk, sk), clone(itemInput));
    return input.ReturnValues === 'ALL_OLD' && existing ? { Attributes: clone(existing) } : {};
  }

  private get(input: Record<string, unknown>): FakeOutput {
    this.checkTable(input);
    const { pk, sk } = this.exactKey(input.Key);
    const item = this.store.get(this.storeKey(pk, sk));
    return item ? { Item: clone(item) } : {};
  }

  private update(input: Record<string, unknown>): FakeOutput {
    this.checkTable(input);
    const { pk, sk } = this.exactKey(input.Key);
    return this.applyUpdateInput(input, pk, sk, this.store.get(this.storeKey(pk, sk)));
  }

  private applyUpdateInput(
    input: Record<string, unknown>,
    pk: string,
    sk: string,
    existing: Item | undefined,
  ): FakeOutput {
    const returnValues = input.ReturnValues ?? 'NONE';
    if (!['NONE', 'ALL_OLD', 'ALL_NEW'].includes(String(returnValues))) {
      throw validation(`ReturnValues ${String(returnValues)} is not supported by the fake`);
    }
    if (typeof input.UpdateExpression !== 'string') {
      throw validation('UpdateExpression is required');
    }
    // One shared context so placeholders used by either expression count as used.
    const context = createContext(
      input.ExpressionAttributeNames as Record<string, string> | undefined,
      input.ExpressionAttributeValues as Record<string, unknown> | undefined,
    );
    if (input.ConditionExpression !== undefined) {
      const condition = parseCondition(String(input.ConditionExpression), context);
      const actions = parseUpdate(input.UpdateExpression, context);
      assertAllUsed(context);
      if (!evaluateCondition(condition, existing ?? {}, context)) {
        throw conditionFailed();
      }
      return this.commitUpdate(actions, context, pk, sk, existing, String(returnValues));
    }
    const actions = parseUpdate(input.UpdateExpression, context);
    assertAllUsed(context);
    return this.commitUpdate(actions, context, pk, sk, existing, String(returnValues));
  }

  private commitUpdate(
    actions: UpdateActions,
    context: ExpressionContext,
    pk: string,
    sk: string,
    existing: Item | undefined,
    returnValues: string,
  ): FakeOutput {
    const base: Item = existing ? clone(existing) : { PK: pk, SK: sk };
    const updated = applyUpdate(base, actions, context, KEY_ATTRIBUTES);
    this.store.set(this.storeKey(pk, sk), updated);
    if (returnValues === 'ALL_NEW') {
      return { Attributes: clone(updated) };
    }
    if (returnValues === 'ALL_OLD' && existing) {
      return { Attributes: clone(existing) };
    }
    return {};
  }

  private delete(input: Record<string, unknown>): FakeOutput {
    this.checkTable(input);
    const { pk, sk } = this.exactKey(input.Key);
    const existing = this.store.get(this.storeKey(pk, sk));
    this.checkCondition(
      input.ConditionExpression,
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues,
      existing,
    );
    this.store.delete(this.storeKey(pk, sk));
    return input.ReturnValues === 'ALL_OLD' && existing ? { Attributes: clone(existing) } : {};
  }

  private query(input: Record<string, unknown>): FakeOutput {
    this.checkTable(input);
    if (typeof input.KeyConditionExpression !== 'string') {
      throw validation('KeyConditionExpression is required');
    }
    const indexName = input.IndexName;
    if (indexName !== undefined && indexName !== 'GSI1') {
      throw validation(`The table does not have the specified index: ${String(indexName)}`);
    }
    const [hashName, rangeName] = indexName === 'GSI1' ? INDEX_ATTRIBUTES : KEY_ATTRIBUTES;
    const context = createContext(
      input.ExpressionAttributeNames as Record<string, string> | undefined,
      input.ExpressionAttributeValues as Record<string, unknown> | undefined,
    );
    const condition = parseCondition(input.KeyConditionExpression, context);
    if (input.FilterExpression !== undefined) {
      throw validation('FilterExpression is not supported by the fake');
    }
    assertAllUsed(context);

    // A key condition must be an equality on the hash key, optionally ANDed with one range condition.
    const terms: Condition[] = [];
    const flatten = (node: Condition): void => {
      if (node.type === 'and') {
        flatten(node.left);
        flatten(node.right);
      } else {
        terms.push(node);
      }
    };
    flatten(condition);
    const hashTerm = terms.find(
      (term) =>
        term.type === 'compare' &&
        term.op === '=' &&
        term.left.type === 'path' &&
        term.left.path.join('.') === hashName,
    );
    if (
      !hashTerm ||
      terms.length > 2 ||
      (terms.length === 2 && !terms.some((term) => term !== hashTerm))
    ) {
      throw validation(
        'Query key condition not supported: must be an equality on the partition key and at most one sort key condition',
      );
    }
    const rangeTerm = terms.find((term) => term !== hashTerm);
    if (rangeTerm) {
      const subject =
        rangeTerm.type === 'compare'
          ? rangeTerm.left
          : rangeTerm.type === 'function'
            ? rangeTerm.args[0]
            : undefined;
      if (!subject || subject.type !== 'path' || subject.path.join('.') !== rangeName) {
        throw validation(
          'Query key condition not supported: range condition must be on the sort key',
        );
      }
      if (rangeTerm.type === 'function' && rangeTerm.name !== 'begins_with') {
        throw validation(
          'Query key condition not supported: only begins_with is allowed on the sort key',
        );
      }
    }

    let matches = [...this.store.values()].filter(
      (item) =>
        typeof item[hashName] === 'string' &&
        typeof item[rangeName] === 'string' &&
        evaluateCondition(condition, item, context),
    );
    // DynamoDB sorts strings by UTF-8 bytes; plain code-unit order matches that for ASCII keys.
    const codeUnitOrder = (a: Item, b: Item): number => {
      const ra = String(a[rangeName]);
      const rb = String(b[rangeName]);
      if (ra !== rb) {
        return ra < rb ? -1 : 1;
      }
      const ka = `${String(a.PK)}\u0000${String(a.SK)}`;
      const kb = `${String(b.PK)}\u0000${String(b.SK)}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    };
    matches.sort(codeUnitOrder);
    if (input.ScanIndexForward === false) {
      matches.reverse();
    }

    const start = input.ExclusiveStartKey;
    if (start !== undefined) {
      if (!isPlainObject(start)) {
        throw validation('ExclusiveStartKey must be a key');
      }
      const startPk = String(start.PK);
      const startSk = String(start.SK);
      const startIndex = matches.findIndex((item) => item.PK === startPk && item.SK === startSk);
      matches = startIndex === -1 ? matches : matches.slice(startIndex + 1);
    }
    const limit = input.Limit;
    if (
      limit !== undefined &&
      (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)
    ) {
      throw validation('Limit must be a positive integer');
    }
    const page = typeof limit === 'number' ? matches.slice(0, limit) : matches;
    const more = typeof limit === 'number' && matches.length > limit;
    const last = page[page.length - 1];
    const result: Record<string, unknown> = {
      Items: page.map((item) => clone(item)),
      Count: page.length,
    };
    if (more && last) {
      result.LastEvaluatedKey =
        indexName === 'GSI1'
          ? { PK: last.PK, SK: last.SK, [hashName]: last[hashName], [rangeName]: last[rangeName] }
          : { PK: last.PK, SK: last.SK };
    }
    return result;
  }

  private batchWrite(input: Record<string, unknown>): FakeOutput {
    const requestItems = input.RequestItems;
    if (!isPlainObject(requestItems)) {
      throw validation('RequestItems is required');
    }
    const tables = Object.keys(requestItems);
    if (tables.length !== 1 || tables[0] !== this.table) {
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
        $metadata: {},
      });
    }
    const requests = requestItems[this.table];
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_BATCH) {
      throw validation(`BatchWriteItem takes between 1 and ${MAX_BATCH} requests`);
    }
    const seen = new Set<string>();
    const operations: (() => void)[] = [];
    for (const request of requests as unknown[]) {
      if (!isPlainObject(request)) {
        throw validation('Each write request must be an object');
      }
      const put = request.PutRequest;
      const del = request.DeleteRequest;
      if ((put === undefined) === (del === undefined)) {
        throw validation('Supplied AttributeValue has more than one datatypes set, or none');
      }
      if (put !== undefined) {
        if (!isPlainObject(put) || !isPlainObject(put.Item)) {
          throw validation('PutRequest needs an Item');
        }
        validateValue(put.Item, 'PutRequest.Item');
        const { pk, sk } = this.keyOf(put.Item, 'item');
        if (seen.has(this.storeKey(pk, sk))) {
          throw validation('Provided list of item keys contains duplicates');
        }
        seen.add(this.storeKey(pk, sk));
        const stored = clone(put.Item);
        operations.push(() => this.store.set(this.storeKey(pk, sk), stored));
      } else {
        const { pk, sk } = this.exactKey(isPlainObject(del) ? del.Key : undefined);
        if (seen.has(this.storeKey(pk, sk))) {
          throw validation('Provided list of item keys contains duplicates');
        }
        seen.add(this.storeKey(pk, sk));
        operations.push(() => this.store.delete(this.storeKey(pk, sk)));
      }
    }
    for (const operation of operations) {
      operation();
    }
    return { UnprocessedItems: {} };
  }
}
