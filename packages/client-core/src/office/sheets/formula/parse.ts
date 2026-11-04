/**
 * Formula parser: tokens → AST. Precedence, tightest first: `:` range, space intersection, `,`
 * union (inside parentheses), unary `+ - @`, `%`, `^` (left-associative), `* /`, `+ -`, `&`,
 * comparisons. Excel binds unary minus tighter than `^`, so `-2^2` is 4. Failures come back as a
 * structured error; nothing throws out of `parseFormula`.
 */

import { errorFromCode, type ErrorCode, type Scalar } from './types.js'
import {
  normalizeFunctionName,
  normalizeName,
  tokenize,
  type RefParts,
  type SheetPrefix,
  type StructuredRef,
  type Token,
} from './tokenize.js'

/** Excel's limit on formula length, in characters. */
export const MAX_FORMULA_LENGTH = 8192
/** Excel's limit on nested function calls. */
export const MAX_FUNCTION_NESTING = 64
/** Limit on any nesting (parentheses, unary operators, calls) so parsing can never overflow the stack. */
export const MAX_PARSE_DEPTH = 256

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=' | ':' | ' ' | ','

export type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'error'; code: ErrorCode; sheet?: SheetPrefix }
  | { type: 'ref'; ref: RefParts }
  /** `name` is normalized (upper case, no `_xlpm.`); `text` is as written. */
  | { type: 'name'; name: string; text: string; sheet?: SheetPrefix }
  | { type: 'structured'; ref: StructuredRef; text: string }
  | { type: 'external'; text: string }
  | { type: 'array'; rows: number; cols: number; data: Scalar[] }
  | { type: 'unary'; op: '-' | '+' | '@'; operand: Node }
  | { type: 'postfix'; op: '%' | '#'; operand: Node }
  | { type: 'binary'; op: BinaryOp; left: Node; right: Node }
  /** `name` is normalized (upper case, no `_xlfn.`/`_xlws.`); `text` is as written. Empty argument slots are `null`. */
  | { type: 'call'; name: string; text: string; sheet?: SheetPrefix; args: (Node | null)[] }
  /** Calling the result of an expression, as in `LAMBDA(x,x+1)(2)`. */
  | { type: 'invoke'; callee: Node; args: (Node | null)[] }
  | { type: 'paren'; expr: Node }

export interface ParseError {
  message: string
  /** Offsets into the formula text. */
  start: number
  end: number
}

export type ParseResult = { ok: true; ast: Node; tokens: Token[] } | { ok: false; error: ParseError; tokens: Token[] }

class ParseFailure {
  constructor(readonly error: ParseError) {}
}

/** Parses formula text without the leading `=`. Never throws. */
export function parseFormula(text: string): ParseResult {
  const source = String(text)
  let tokens: Token[] = []
  try {
    if (source.length > MAX_FORMULA_LENGTH) {
      return { ok: false, error: { message: `Formula is longer than ${MAX_FORMULA_LENGTH} characters`, start: 0, end: source.length }, tokens }
    }
    tokens = tokenize(source)
    const invalid = tokens.find((token) => token.kind === 'invalid')
    if (invalid) return { ok: false, error: { message: invalid.message ?? 'Invalid formula', start: invalid.start, end: invalid.end }, tokens }
    const parser = new Parser(significantTokens(tokens), source.length)
    return { ok: true, ast: parser.parseRoot(), tokens }
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, error: error.error, tokens }
    return { ok: false, error: { message: 'Formula is too complex', start: 0, end: source.length }, tokens }
  }
}

const ENDS_OPERAND = new Set(['number', 'string', 'bool', 'error', 'ref', 'name', 'structured', 'external', 'close', 'array-close'])
const STARTS_OPERAND = new Set(['number', 'string', 'bool', 'error', 'ref', 'name', 'function', 'structured', 'external', 'open', 'array-open'])

function endsOperand(token: Token): boolean {
  return ENDS_OPERAND.has(token.kind) || (token.kind === 'operator' && (token.text === '%' || token.text === '#'))
}

function startsOperand(token: Token): boolean {
  return STARTS_OPERAND.has(token.kind) || (token.kind === 'operator' && token.text === '@')
}

/** Drops whitespace, except whitespace between two operands, which is the intersection operator. */
function significantTokens(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]!
    if (token.kind !== 'whitespace') {
      out.push(token)
      continue
    }
    const previous = out[out.length - 1]
    let next: Token | undefined
    for (let m = k + 1; m < tokens.length; m++) {
      if (tokens[m]!.kind !== 'whitespace') {
        next = tokens[m]
        break
      }
    }
    if (previous && next && endsOperand(previous) && startsOperand(next)) {
      out.push({ kind: 'operator', text: ' ', start: token.start, end: token.end })
    }
  }
  return out
}

const COMPARISONS = new Set(['=', '<>', '<', '>', '<=', '>='])
const LITERAL_TYPES = new Set(['number', 'string', 'bool', 'array'])

class Parser {
  private pos = 0
  private depth = 0
  private functionDepth = 0

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
  ) {}

  parseRoot(): Node {
    if (!this.tokens.length) this.fail('Empty formula')
    const node = this.parseExpression(true)
    const extra = this.peek()
    if (extra) this.fail(extra.kind === 'close' ? 'Unmatched )' : `Unexpected ${extra.text}`, extra)
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private next(): Token {
    const token = this.tokens[this.pos]
    if (!token) this.fail('Unexpected end of formula')
    this.pos++
    return token
  }

  private isOperator(token: Token | undefined, ...ops: string[]): boolean {
    return token !== undefined && token.kind === 'operator' && ops.includes(token.text)
  }

  private fail(message: string, token?: Token): never {
    throw new ParseFailure({ message, start: token?.start ?? this.length, end: token?.end ?? this.length })
  }

  private enter(token?: Token): void {
    if (++this.depth > MAX_PARSE_DEPTH) this.fail('Formula is nested too deeply', token)
  }

  private leave(): void {
    this.depth--
  }

  private parseExpression(allowUnion: boolean): Node {
    this.enter(this.peek())
    let node = this.parseComparison()
    while (allowUnion && this.peek()?.kind === 'comma') {
      this.next()
      node = { type: 'binary', op: ',', left: node, right: this.parseComparison() }
    }
    this.leave()
    return node
  }

  private parseComparison(): Node {
    let left = this.parseConcat()
    for (let token = this.peek(); token?.kind === 'operator' && COMPARISONS.has(token.text); token = this.peek()) {
      this.next()
      left = { type: 'binary', op: token.text as BinaryOp, left, right: this.parseConcat() }
    }
    return left
  }

  private parseConcat(): Node {
    let left = this.parseAdditive()
    while (this.isOperator(this.peek(), '&')) {
      this.next()
      left = { type: 'binary', op: '&', left, right: this.parseAdditive() }
    }
    return left
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative()
    for (let token = this.peek(); this.isOperator(token, '+', '-'); token = this.peek()) {
      this.next()
      left = { type: 'binary', op: token!.text as BinaryOp, left, right: this.parseMultiplicative() }
    }
    return left
  }

  private parseMultiplicative(): Node {
    let left = this.parsePower()
    for (let token = this.peek(); this.isOperator(token, '*', '/'); token = this.peek()) {
      this.next()
      left = { type: 'binary', op: token!.text as BinaryOp, left, right: this.parsePower() }
    }
    return left
  }

  private parsePower(): Node {
    let left = this.parsePercent()
    while (this.isOperator(this.peek(), '^')) {
      this.next()
      left = { type: 'binary', op: '^', left, right: this.parsePercent() }
    }
    return left
  }

  private parsePercent(): Node {
    let node = this.parseUnary()
    while (this.isOperator(this.peek(), '%')) {
      this.next()
      node = { type: 'postfix', op: '%', operand: node }
    }
    return node
  }

  private parseUnary(): Node {
    const token = this.peek()
    if (this.isOperator(token, '-', '+', '@')) {
      this.next()
      this.enter(token)
      const operand = this.parseUnary()
      this.leave()
      return { type: 'unary', op: token!.text as '-' | '+' | '@', operand }
    }
    return this.parseIntersection()
  }

  private parseIntersection(): Node {
    let left = this.parseRange()
    for (let token = this.peek(); this.isOperator(token, ' '); token = this.peek()) {
      this.next()
      const right = this.parseRange()
      if (LITERAL_TYPES.has(left.type) || LITERAL_TYPES.has(right.type)) this.fail('Missing operator', token)
      left = { type: 'binary', op: ' ', left, right }
    }
    return left
  }

  private parseRange(): Node {
    let left = this.parseSpill()
    while (this.isOperator(this.peek(), ':')) {
      this.next()
      left = { type: 'binary', op: ':', left, right: this.parseSpill() }
    }
    return left
  }

  private parseSpill(): Node {
    let node = this.parsePrimary()
    while (this.isOperator(this.peek(), '#')) {
      this.next()
      node = { type: 'postfix', op: '#', operand: node }
    }
    return node
  }

  private parsePrimary(): Node {
    const token = this.next()
    switch (token.kind) {
      case 'number':
        return { type: 'number', value: token.value as number }
      case 'string':
        return { type: 'string', value: token.value as string }
      case 'bool':
        return { type: 'bool', value: token.value as boolean }
      case 'error':
        return token.sheet ? { type: 'error', code: token.error!, sheet: token.sheet } : { type: 'error', code: token.error! }
      case 'ref':
        return { type: 'ref', ref: token.ref! }
      case 'name': {
        const node: Node = { type: 'name', name: normalizeName(token.name!), text: token.name! }
        if (token.sheet) node.sheet = token.sheet
        return node
      }
      case 'structured':
        return { type: 'structured', ref: token.structured!, text: token.text }
      case 'external':
        return { type: 'external', text: token.text }
      case 'function':
        return this.parseInvocations(this.parseCall(token))
      case 'open': {
        this.enter(token)
        const expr = this.parseExpression(true)
        const close = this.next()
        if (close.kind !== 'close') this.fail('Expected )', close)
        this.leave()
        return this.parseInvocations({ type: 'paren', expr })
      }
      case 'array-open':
        return this.parseArray(token)
      default:
        this.fail(token.kind === 'close' ? 'Unexpected )' : `Unexpected ${token.text || token.kind}`, token)
    }
  }

  private parseCall(token: Token): Node {
    const open = this.next()
    if (open.kind !== 'open') this.fail('Expected (', open)
    if (++this.functionDepth > MAX_FUNCTION_NESTING) this.fail(`More than ${MAX_FUNCTION_NESTING} nested functions`, token)
    this.enter(token)
    const args = this.parseArgs()
    this.leave()
    this.functionDepth--
    const node: Node = { type: 'call', name: normalizeFunctionName(token.name!), text: token.name!, args }
    if (token.sheet) node.sheet = token.sheet
    return node
  }

  /** Arguments after `(`, through the closing `)`. */
  private parseArgs(): (Node | null)[] {
    const args: (Node | null)[] = []
    if (this.peek()?.kind === 'close') {
      this.next()
      return args
    }
    for (;;) {
      const token = this.peek()
      if (!token) this.fail('Missing )')
      args.push(token.kind === 'comma' || token.kind === 'close' ? null : this.parseExpression(false))
      const separator = this.next()
      if (separator.kind === 'close') return args
      if (separator.kind !== 'comma') this.fail(`Expected , or ) but found ${separator.text}`, separator)
    }
  }

  /** `LAMBDA(x,x+1)(2)`: a call directly followed by `(` calls its result. */
  private parseInvocations(callee: Node): Node {
    let node = callee
    while (this.peek()?.kind === 'open') {
      const open = this.next()
      this.enter(open)
      node = { type: 'invoke', callee: node, args: this.parseArgs() }
      this.leave()
    }
    return node
  }

  private parseArray(open: Token): Node {
    const rows: Scalar[][] = [[]]
    for (;;) {
      let token = this.next()
      let sign = 1
      if (this.isOperator(token, '-', '+')) {
        if (token.text === '-') sign = -1
        token = this.next()
        if (token.kind !== 'number') this.fail('Expected a number in the array', token)
      }
      let value: Scalar
      switch (token.kind) {
        case 'number':
          value = sign * (token.value as number)
          break
        case 'string':
        case 'bool':
          value = token.value as string | boolean
          break
        case 'error':
          if (token.sheet) this.fail('References are not allowed in arrays', token)
          value = errorFromCode(token.error!)!
          break
        default:
          this.fail('Arrays may only contain numbers, text, booleans, and errors', token)
      }
      rows[rows.length - 1]!.push(value)
      const separator = this.next()
      if (separator.kind === 'comma') continue
      if (separator.kind === 'semicolon') {
        rows.push([])
        continue
      }
      if (separator.kind === 'array-close') {
        const cols = rows[0]!.length
        if (rows.some((row) => row.length !== cols)) this.fail('Array rows have different lengths', open)
        return { type: 'array', rows: rows.length, cols, data: rows.flat() }
      }
      this.fail('Expected , ; or } in the array', separator)
    }
  }
}
