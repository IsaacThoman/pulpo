import { describe, expect, it } from 'vitest'
import { formatReference, mapReferences, r1c1ToA1, shiftFormula } from './translate.js'

describe('shiftFormula', () => {
  it('moves relative parts and keeps absolute ones', () => {
    expect(shiftFormula('A1+$B$2+C$3+$D4', 2, 1)).toBe('B3+$B$2+D$3+$D6')
    expect(shiftFormula('SUM(A1:B2)', 1, 0)).toBe('SUM(A2:B3)')
    expect(shiftFormula('SUM($A$1:B2)', 1, 1)).toBe('SUM($A$1:C3)')
    expect(shiftFormula('A:A', 5, 1)).toBe('B:B')
    expect(shiftFormula('$A:A', 0, 2)).toBe('$A:C')
    expect(shiftFormula('1:1', 3, 9)).toBe('4:4')
    expect(shiftFormula("'My Sheet'!A1*2", 1, 0)).toBe("'My Sheet'!A2*2")
  })

  it('turns references pushed off the grid into #REF!', () => {
    expect(shiftFormula('A1+B2', -1, 0)).toBe('#REF!+B1')
    expect(shiftFormula('Sheet2!A1', 0, -1)).toBe('Sheet2!#REF!')
    expect(shiftFormula('SUM(A1:B5)', -1, 0)).toBe('SUM(#REF!)')
    expect(shiftFormula('XFD1', 0, 1)).toBe('#REF!')
  })

  it('leaves strings, names, structured and external references alone', () => {
    expect(shiftFormula('"A1"&A1&Table1[Col]&MyName&[1]Sheet1!A1', 1, 1)).toBe('"A1"&B2&Table1[Col]&MyName&[1]Sheet1!A1')
  })

  it('keeps whitespace and is identity for zero offsets', () => {
    expect(shiftFormula('SUM( A1 ,  B1 )', 1, 0)).toBe('SUM( A2 ,  B2 )')
    expect(shiftFormula('anything (', 0, 0)).toBe('anything (')
  })
})

describe('mapReferences', () => {
  it('passes parsed parts and replaces with returned text', () => {
    const seen: string[] = []
    const out = mapReferences("A1+'S 2'!$B$2:C3+D:D+5:5", (ref) => {
      seen.push(`${ref.kind}|${ref.sheet?.sheet ?? ''}|${ref.row},${ref.col}|${ref.rowAbs},${ref.colAbs}`)
      return ref.kind === 'cell' ? `{${ref.row},${ref.col}}` : undefined
    })
    expect(out).toBe("{0,0}+'S 2'!$B$2:C3+D:D+5:5")
    expect(seen).toEqual(['cell||0,0|false,false', 'range|S 2|1,1|true,true', 'cols||0,3|false,false', 'rows||4,0|false,false'])
  })

  it('survives malformed formulas', () => {
    expect(mapReferences('SUM(A1, "oops', () => 'X')).toBe('SUM(X, "oops')
  })
})

describe('formatReference', () => {
  it('quotes sheet names when needed', () => {
    expect(formatReference({ kind: 'cell', row: 0, col: 0, row2: 0, col2: 0, rowAbs: false, colAbs: false, row2Abs: false, col2Abs: false, sheet: { sheet: "Bob's" } })).toBe("'Bob''s'!A1")
    expect(formatReference({ kind: 'cell', row: 0, col: 0, row2: 0, col2: 0, rowAbs: false, colAbs: false, row2Abs: false, col2Abs: false, sheet: { sheet: 'A1' } })).toBe("'A1'!A1")
    expect(formatReference({ kind: 'range', row: 0, col: 0, row2: 1, col2: 1, rowAbs: false, colAbs: false, row2Abs: false, col2Abs: false, sheet: { sheet: 'Jan', lastSheet: 'Mar' } })).toBe('Jan:Mar!A1:B2')
  })
})

describe('r1c1ToA1', () => {
  it('converts absolute, relative, and whole row/column references', () => {
    expect(r1c1ToA1('R1C1', 5, 5)).toBe('$A$1')
    expect(r1c1ToA1('R[1]C[-1]', 5, 5)).toBe('E7')
    expect(r1c1ToA1('RC', 2, 3)).toBe('D3')
    expect(r1c1ToA1('R2C[1]', 0, 0)).toBe('B$2')
    expect(r1c1ToA1('SUM(R1C1:R2C3)', 0, 0)).toBe('SUM($A$1:$C$2)')
    expect(r1c1ToA1('R2', 0, 0)).toBe('$2:$2')
    expect(r1c1ToA1('C3:C4', 0, 0)).toBe('$C:$D')
    expect(r1c1ToA1("'R1C1'!R1C1&\"R1C1\"", 0, 0)).toBe("'R1C1'!$A$1&\"R1C1\"")
    expect(r1c1ToA1('ROUND(RATE,2)', 0, 0)).toBe('ROUND(RATE,2)')
    expect(r1c1ToA1('R[-1]C', 0, 0)).toBe('#REF!')
  })
})
