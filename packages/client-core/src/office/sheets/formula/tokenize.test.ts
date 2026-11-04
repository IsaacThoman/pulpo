import { describe, expect, it } from 'vitest'
import { tokenize, type Token } from './tokenize.js'

/** `kind:text` for every significant token. */
function kinds(formula: string): string[] {
  return tokenize(formula)
    .filter((token) => token.kind !== 'whitespace')
    .map((token) => `${token.kind}:${token.text}`)
}

function only(formula: string): Token {
  const tokens = tokenize(formula)
  expect(tokens).toHaveLength(1)
  return tokens[0]!
}

describe('tokenize', () => {
  it('reads numbers', () => {
    for (const [text, value] of [
      ['1', 1],
      ['1.5', 1.5],
      ['.5', 0.5],
      ['1e-3', 0.001],
      ['2E+10', 2e10],
      ['3.', 3],
      ['0012', 12],
    ] as const) {
      const token = only(text)
      expect(token.kind).toBe('number')
      expect(token.value).toBe(value)
    }
  })

  it('reads strings with doubled quotes', () => {
    const token = only('"say ""hi"""')
    expect(token.kind).toBe('string')
    expect(token.value).toBe('say "hi"')
    expect(only('""').value).toBe('')
    expect(only('"unterminated').kind).toBe('invalid')
  })

  it('reads booleans and error literals', () => {
    expect(only('TRUE').value).toBe(true)
    expect(only('false').value).toBe(false)
    expect(kinds('TRUE()')).toEqual(['function:TRUE', 'open:(', 'close:)'])
    for (const code of ['#N/A', '#REF!', '#DIV/0!', '#NAME?', '#VALUE!', '#NUM!', '#NULL!', '#SPILL!', '#CALC!', '#GETTING_DATA', '#BLOCKED!']) {
      const token = only(code)
      expect(token.kind).toBe('error')
      expect(token.error).toBe(code)
    }
    expect(only('#n/a').error).toBe('#N/A')
    expect(tokenize('#BOGUS')[0]!.kind).toBe('invalid')
  })

  it('reads cell references with absolute markers', () => {
    const token = only('$B$7')
    expect(token.ref).toMatchObject({ kind: 'cell', row: 6, col: 1, rowAbs: true, colAbs: true })
    expect(only('A$1').ref).toMatchObject({ rowAbs: true, colAbs: false })
    expect(only('$A1').ref).toMatchObject({ rowAbs: false, colAbs: true })
    expect(only('XFD1048576').ref).toMatchObject({ row: 1048575, col: 16383 })
    expect(only('xfd1').ref).toMatchObject({ col: 16383 })
  })

  it('treats cell-like text beyond the grid, or with suffixes, as names', () => {
    expect(only('XFE1').kind).toBe('name')
    expect(only('A1048577').kind).toBe('name')
    expect(only('A1B').kind).toBe('name')
    expect(only('R1C1').kind).toBe('name')
    expect(only('ABCD1').kind).toBe('name')
    expect(kinds('LOG10(1)')).toEqual(['function:LOG10', 'open:(', 'number:1', 'close:)'])
  })

  it('reads ranges, whole columns, and whole rows', () => {
    expect(only('A1:B2').ref).toMatchObject({ kind: 'range', row: 0, col: 0, row2: 1, col2: 1 })
    expect(only('B2:A1').ref).toMatchObject({ row: 1, col: 1, row2: 0, col2: 0 })
    expect(only('$A$1:B$2').ref).toMatchObject({ rowAbs: true, colAbs: true, row2Abs: true, col2Abs: false })
    expect(only('A:C').ref).toMatchObject({ kind: 'cols', col: 0, col2: 2, row: 0, row2: 1048575 })
    expect(only('$A:$A').ref).toMatchObject({ kind: 'cols', colAbs: true, col2Abs: true })
    expect(only('1:3').ref).toMatchObject({ kind: 'rows', row: 0, row2: 2, col: 0, col2: 16383 })
    expect(only('$2:$2').ref).toMatchObject({ kind: 'rows', rowAbs: true })
  })

  it('reads sheet-qualified references', () => {
    const token = only('Sheet1!A1')
    expect(token.kind).toBe('ref')
    expect(token.sheet).toEqual({ sheet: 'Sheet1' })
    expect(token.ref).toMatchObject({ kind: 'cell', sheet: { sheet: 'Sheet1' } })
    expect(only("'My ''Sheet'''!A1:B2").sheet).toEqual({ sheet: "My 'Sheet'" })
    expect(only("'Sheet ''1'''!A1").sheet).toEqual({ sheet: "Sheet '1'" })
    expect(only('Data!A:A').ref).toMatchObject({ kind: 'cols' })
    expect(only("'2024'!1:1").ref).toMatchObject({ kind: 'rows', sheet: { sheet: '2024' } })
    expect(only('Sheet1!#REF!')).toMatchObject({ kind: 'error', error: '#REF!', sheet: { sheet: 'Sheet1' } })
  })

  it('reads 3D references', () => {
    expect(only('Sheet1:Sheet3!A1').sheet).toEqual({ sheet: 'Sheet1', lastSheet: 'Sheet3' })
    expect(only("'Jan 1:Mar 3'!B2:C3").sheet).toEqual({ sheet: 'Jan 1', lastSheet: 'Mar 3' })
  })

  it('keeps external references opaque', () => {
    for (const text of ['[1]Sheet1!A1', "'[Book.xlsx]Sheet'!A1", '[Book1.xlsx]Sheet1!$A$1:$B$2', "'C:\\dir\\[Book.xlsx]My Sheet'!A1", '[1]!MyName']) {
      expect(only(text).kind).toBe('external')
    }
    expect(kinds('SUM([1]Sheet1!A1:A3)')).toEqual(['function:SUM', 'open:(', 'external:[1]Sheet1!A1:A3', 'close:)'])
  })

  it('reads names, sheet-scoped names, and functions with prefixes', () => {
    expect(only('TaxRate')).toMatchObject({ kind: 'name', name: 'TaxRate' })
    expect(only('Sheet1!MyName')).toMatchObject({ kind: 'name', name: 'MyName', sheet: { sheet: 'Sheet1' } })
    expect(only('_xlpm.x')).toMatchObject({ kind: 'name', name: '_xlpm.x' })
    expect(only('my.name?')).toMatchObject({ kind: 'name' })
    expect(only('\\backslash')).toMatchObject({ kind: 'name' })
    expect(kinds('_xlfn._xlws.SORT(A1:A5)')).toEqual(['function:_xlfn._xlws.SORT', 'open:(', 'ref:A1:A5', 'close:)'])
    expect(kinds('_xlfn.STDEV.S(A1)')).toEqual(['function:_xlfn.STDEV.S', 'open:(', 'ref:A1', 'close:)'])
    expect(kinds('Sheet2!Fn(1)')[0]).toBe('function:Sheet2!Fn')
  })

  it('reads structured references', () => {
    expect(only('Table1[Col]').structured).toEqual({ table: 'Table1', items: [], firstColumn: 'Col' })
    expect(only('Table1[]').structured).toEqual({ table: 'Table1', items: [] })
    expect(only('Table1[#All]').structured).toEqual({ table: 'Table1', items: ['#All'] })
    expect(only('Table1[[#Headers],[Col A]:[Col B]]').structured).toEqual({ table: 'Table1', items: ['#Headers'], firstColumn: 'Col A', lastColumn: 'Col B' })
    expect(only('[@Col]').structured).toEqual({ items: ['#This Row'], firstColumn: 'Col' })
    expect(only('Table1[@[Col 1]]').structured).toEqual({ table: 'Table1', items: ['#This Row'], firstColumn: 'Col 1' })
    expect(only('Table1[[#This Row],[Amount]]').structured).toEqual({ table: 'Table1', items: ['#This Row'], firstColumn: 'Amount' })
    expect(only('Table1[[#Data], [#Totals], [Qty]]').structured).toEqual({ table: 'Table1', items: ['#Data', '#Totals'], firstColumn: 'Qty' })
    expect(only("T[[a'[b']]]").structured).toEqual({ table: 'T', items: [], firstColumn: 'a[b]' })
    expect(only("T['#count]").structured).toEqual({ table: 'T', items: [], firstColumn: '#count' })
    expect(only("T[it''s]").structured).toEqual({ table: 'T', items: [], firstColumn: "it's" })
    expect(only('[@]').structured).toEqual({ items: ['#This Row'] })
    expect(only('Table1[#Bogus]').kind).toBe('invalid')
    expect(only('Table1[unclosed').kind).toBe('invalid')
  })

  it('reads array constants', () => {
    expect(kinds('{1,-2;"a",TRUE}')).toEqual([
      'array-open:{',
      'number:1',
      'comma:,',
      'operator:-',
      'number:2',
      'semicolon:;',
      'string:"a"',
      'comma:,',
      'bool:TRUE',
      'array-close:}',
    ])
    expect(kinds('{#N/A}')).toEqual(['array-open:{', 'error:#N/A', 'array-close:}'])
  })

  it('reads operators, including two-character ones', () => {
    expect(kinds('1<>2<=3>=4<5>6=7')).toEqual([
      'number:1',
      'operator:<>',
      'number:2',
      'operator:<=',
      'number:3',
      'operator:>=',
      'number:4',
      'operator:<',
      'number:5',
      'operator:>',
      'number:6',
      'operator:=',
      'number:7',
    ])
    expect(kinds('-A1%^2&"x"*3/4+@B1:B2')).toEqual([
      'operator:-',
      'ref:A1',
      'operator:%',
      'operator:^',
      'number:2',
      'operator:&',
      'string:"x"',
      'operator:*',
      'number:3',
      'operator:/',
      'number:4',
      'operator:+',
      'operator:@',
      'ref:B1:B2',
    ])
  })

  it('reads spill references as a postfix operator', () => {
    expect(kinds('A1#')).toEqual(['ref:A1', 'operator:#'])
    expect(kinds('SUM(Sheet1!$B$2#)')).toEqual(['function:SUM', 'open:(', 'ref:Sheet1!$B$2', 'operator:#', 'close:)'])
  })

  it('reads intersections and unions', () => {
    const tokens = tokenize('SUM(A1:A3 A2:B2)')
    expect(tokens.map((token) => token.kind)).toEqual(['function', 'open', 'ref', 'whitespace', 'ref', 'close'])
    expect(kinds('SUM((A1,B1))')).toEqual(['function:SUM', 'open:(', 'open:(', 'ref:A1', 'comma:,', 'ref:B1', 'close:)', 'close:)'])
  })

  it('splits ranges that cannot be single tokens into operators', () => {
    expect(kinds('A1:INDEX(B:B,2)')).toEqual(['ref:A1', 'operator::', 'function:INDEX', 'open:(', 'ref:B:B', 'comma:,', 'number:2', 'close:)'])
    expect(kinds('Name1:Name2')).toEqual(['name:Name1', 'operator::', 'name:Name2'])
  })

  it('keeps exact offsets', () => {
    const formula = "SUM( 'My Sheet'!A1:B2 , [@Qty] )+1"
    for (const token of tokenize(formula)) expect(formula.slice(token.start, token.end)).toBe(token.text)
    const ref = tokenize(formula).find((token) => token.kind === 'ref')!
    expect(ref.start).toBe(5)
    expect(ref.text).toBe("'My Sheet'!A1:B2")
  })

  it('never throws and covers the input with tokens', () => {
    for (const text of ['', '~', '`', "'", "'abc", "'abc'", '[', '[]', '{', '#', '$', '$$', '1:', 'A1:', '!!', 'Sheet1!', "'x'!", '\u0000', '\uD800']) {
      const tokens = tokenize(text)
      expect(tokens.map((token) => token.text).join('')).toBe(text)
    }
  })
})
