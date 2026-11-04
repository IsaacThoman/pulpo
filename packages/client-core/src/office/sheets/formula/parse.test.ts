import { describe, expect, it } from 'vitest'
import { parseFormula, type Node } from './parse.js'
import { formatReference, serialize } from './translate.js'

/** Fully parenthesized S-expression form, to make precedence visible. */
function sexpr(node: Node): string {
  switch (node.type) {
    case 'number':
      return String(node.value)
    case 'string':
      return JSON.stringify(node.value)
    case 'bool':
      return String(node.value).toUpperCase()
    case 'error':
      return node.code
    case 'ref':
      return formatReference(node.ref)
    case 'name':
      return node.name
    case 'structured':
    case 'external':
      return node.text
    case 'array':
      return serialize(node)
    case 'unary':
      return `(${node.op} ${sexpr(node.operand)})`
    case 'postfix':
      return `(${sexpr(node.operand)} ${node.op})`
    case 'binary':
      return `(${node.op === ' ' ? '∩' : node.op} ${sexpr(node.left)} ${sexpr(node.right)})`
    case 'call':
      return `${node.name}[${node.args.map((arg) => (arg ? sexpr(arg) : '_')).join(' ')}]`
    case 'invoke':
      return `invoke[${sexpr(node.callee)} ${node.args.map((arg) => (arg ? sexpr(arg) : '_')).join(' ')}]`
    case 'paren':
      return sexpr(node.expr)
  }
}

function tree(formula: string): string {
  const result = parseFormula(formula)
  if (!result.ok) throw new Error(`${formula}: ${result.error.message}`)
  return sexpr(result.ast)
}

function error(formula: string): string {
  const result = parseFormula(formula)
  if (result.ok) throw new Error(`${formula} parsed`)
  return result.error.message
}

describe('parseFormula', () => {
  it.each([
    ['1+2*3', '(+ 1 (* 2 3))'],
    ['(1+2)*3', '(* (+ 1 2) 3)'],
    ['1-2-3', '(- (- 1 2) 3)'],
    ['2^3^2', '(^ (^ 2 3) 2)'],
    ['-2^2', '(^ (- 2) 2)'],
    ['2^-1', '(^ 2 (- 1))'],
    ['-A1%', '((- A1) %)'],
    ['50%^2', '(^ (50 %) 2)'],
    ['1+2&3', '(& (+ 1 2) 3)'],
    ['"a"&1=1', '(= (& "a" 1) 1)'],
    ['1<2=TRUE', '(= (< 1 2) TRUE)'],
    ['1+-+-2', '(+ 1 (- (+ (- 2))))'],
    ['A1:B2 B1:C3', '(∩ A1:B2 B1:C3)'],
    ['SUM(A1:A3 A2:B2)', 'SUM[(∩ A1:A3 A2:B2)]'],
    ['SUM((A1,B1),C1)', 'SUM[(, A1 B1) C1]'],
    ['-A1:B2', '(- A1:B2)'],
    ['A1:INDEX(B:B,2)', '(: A1 INDEX[B:B 2])'],
    ['@A1:A10', '(@ A1:A10)'],
    ['A1#', '(A1 #)'],
    ['SUM(A1#)*2', '(* SUM[(A1 #)] 2)'],
    ['A1 :B2', '(: A1 B2)'],
    [' 1 + 2 ', '(+ 1 2)'],
  ])('parses %s', (formula, expected) => {
    expect(tree(formula)).toBe(expected)
  })

  it('parses calls with empty and missing arguments', () => {
    expect(tree('NOW()')).toBe('NOW[]')
    expect(tree('IF(A1,,1)')).toBe('IF[A1 _ 1]')
    expect(tree('F(,)')).toBe('F[_ _]')
    expect(tree('ROUND(1.5,)')).toBe('ROUND[1.5 _]')
    expect(tree('F( 1 , 2 )')).toBe('F[1 2]')
  })

  it('normalizes function names and LAMBDA parameter names', () => {
    expect(tree('_xlfn._xlws.SORT(A1:A5)')).toBe('SORT[A1:A5]')
    expect(tree('_xlfn.LET(_xlpm.x,1,_xlpm.x+1)')).toBe('LET[X 1 (+ X 1)]')
    expect(tree('sum(a1)')).toBe('SUM[A1]')
  })

  it('parses immediate LAMBDA invocation', () => {
    expect(tree('LAMBDA(x,x+1)(2)')).toBe('invoke[LAMBDA[X (+ X 1)] 2]')
    expect(tree('(LAMBDA(x,x))(1)')).toBe('invoke[LAMBDA[X X] 1]')
  })

  it('parses array constants', () => {
    const result = parseFormula('{1,-2;"a",TRUE}')
    expect(result.ok && result.ast).toMatchObject({ type: 'array', rows: 2, cols: 2, data: [1, -2, 'a', true] })
    expect(tree('{1;2;3}')).toBe('{1;2;3}')
    expect(tree('SUM({1,2,3})')).toBe('SUM[{1,2,3}]')
    expect(error('{1,2;3}')).toMatch(/different lengths/)
    expect(error('{A1}')).toMatch(/Arrays may only contain/)
    expect(error('{}')).toMatch(/Arrays may only contain/)
  })

  it('reports structured errors without throwing', () => {
    expect(error('')).toBe('Empty formula')
    expect(error('1+')).toMatch(/end of formula/)
    expect(error('(1')).toMatch(/Expected \)|end/)
    expect(error('1)')).toMatch(/Unmatched/)
    expect(error('SUM(1')).toMatch(/end of formula|Missing/)
    expect(error('1 2')).toMatch(/Missing operator/)
    expect(error('"abc')).toMatch(/Unterminated/)
    const result = parseFormula('1+*2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ start: 2, end: 3 })
  })

  it('limits length and nesting', () => {
    expect(error('1+'.repeat(4100) + '1')).toMatch(/longer than 8192/)
    expect(error('('.repeat(300) + '1' + ')'.repeat(300))).toMatch(/nested too deeply/)
    expect(error('-'.repeat(300) + '1')).toMatch(/nested too deeply/)
    expect(error('ABS('.repeat(65) + '1' + ')'.repeat(65))).toMatch(/nested functions/)
    expect(parseFormula('ABS('.repeat(64) + '1' + ')'.repeat(64)).ok).toBe(true)
    // Long flat chains are fine (and evaluated iteratively).
    expect(parseFormula('1+'.repeat(4000) + '1').ok).toBe(true)
  })

  it('round-trips through serialize', () => {
    for (const formula of [
      'SUM(A1:B2,$C$3)*-2^2%',
      "'My Sheet'!A1+Sheet2!B:B",
      'IF(A1>=1,"a""b",#N/A)',
      'Table1[[#Headers],[A]:[B]]',
      '{1,-2;"x",FALSE}',
      'LAMBDA(x,x+1)(2)',
      'A1:A3 A2:B2',
      'SUM((A1,B1))',
      'Sheet1:Sheet3!A1',
      '_xlfn.XLOOKUP(1,A:A,B:B)',
      'A1#',
      '@A1:A3',
      '1E-07+1E+21',
    ]) {
      const result = parseFormula(formula)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const text = serialize(result.ast)
      const again = parseFormula(text)
      expect(again.ok && sexpr(again.ast)).toBe(sexpr(result.ast))
    }
  })
})
