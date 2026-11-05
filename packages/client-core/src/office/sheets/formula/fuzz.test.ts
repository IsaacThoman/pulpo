import { describe, expect, it } from 'vitest'
import { FormulaEngine } from './engine.js'
import { parseFormula } from './parse.js'
import { testFunctions } from './testing.js'
import { tokenize } from './tokenize.js'
import { mapReferences, r1c1ToA1, serialize, shiftFormula } from './translate.js'

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
}

const random = seeded(1234)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!

const CHARS = ' ()[]{},;:!#@$%^&*/+-=<>"\'.0123456789ABCabcRCxyz_\\?\n\t~|é'
const PIECES = [
  'A1',
  '$B$2',
  'A1:B3',
  'A:A',
  '1:2',
  'Sheet1!',
  "'My Sheet'!",
  'Sheet2!C3',
  'SUM(',
  'IF(',
  'LET(',
  'LAMBDA(',
  'MAP(',
  'INDEX(',
  'OFFSET(',
  'INDIRECT(',
  'SEQUENCE(',
  'REDUCE(',
  'x',
  ',',
  ')',
  '(',
  '{1,2;3,4}',
  '"str"',
  '#N/A',
  '#REF!',
  'TRUE',
  '1e5',
  '-',
  '+',
  '*',
  '^',
  '&',
  '%',
  '#',
  '@',
  ' ',
  ':',
  'Table1[Col]',
  '[@Col]',
  '[1]Sheet1!A1',
  'Name',
  '_xlfn.',
  '"A1"',
  '"R1C1"',
  'FALSE',
]

function randomText(): string {
  let text = ''
  const length = Math.floor(random() * 30)
  for (let i = 0; i < length; i++) text += random() < 0.3 ? pick([...CHARS]) : pick(PIECES)
  return text
}

describe('hostile input', () => {
  it('never throws from tokenize, parse, serialize, or the translators', () => {
    for (let i = 0; i < 20_000; i++) {
      const text = randomText()
      const tokens = tokenize(text)
      expect(tokens.map((token) => token.text).join('')).toBe(text)
      const parsed = parseFormula(text)
      if (parsed.ok) {
        const again = parseFormula(serialize(parsed.ast))
        expect(again.ok).toBe(true)
      }
      shiftFormula(text, 3, -2)
      mapReferences(text, () => 'Z9')
      r1c1ToA1(text, 2, 2)
    }
  })

  it('never throws or hangs while evaluating random formulas', () => {
    const engine = new FormulaEngine({ functions: testFunctions(), random: seeded(9) })
    engine.setSheets(['Sheet1', 'Sheet2'])
    engine.setName('Name', 'LAMBDA(x,x)')
    engine.setTables([{ name: 'Table1', sheet: 0, top: 10, left: 0, bottom: 14, right: 1, headerRow: true, totalsRow: false, columns: ['Col', 'Other'] }])
    const start = Date.now()
    for (let round = 0; round < 300; round++) {
      for (let k = 0; k < 10; k++) {
        const row = Math.floor(random() * 12)
        const col = Math.floor(random() * 4)
        const roll = random()
        engine.setCell(Math.floor(random() * 2), row, col, roll < 0.2 ? { value: Math.floor(random() * 10) } : roll < 0.25 ? undefined : { formula: randomText() })
      }
      engine.recalc({ full: round % 50 === 0 })
      for (let row = 0; row < 12; row++) for (let col = 0; col < 4; col++) engine.getValue(0, row, col)
    }
    expect(Date.now() - start).toBeLessThan(20_000)
  })

  it('survives pathological but valid formulas', () => {
    const engine = new FormulaEngine({ functions: testFunctions() })
    engine.setSheets(['Sheet1'])
    const formulas = [
      'MAKEARRAY(100000,100000,LAMBDA(r,c,1))',
      'SEQUENCE(2000000)',
      'SUM(OFFSET(A1,0,0,1048576,16384))',
      'ROWS(A:XFD)',
      'LET(f,LAMBDA(f,n,f(f,n+1)),f(f,1))',
      'INDIRECT(REPT("A",10))',
      '(' .repeat(250) + '1' + ')'.repeat(250),
      'A1:XFD1048576+1',
      '{1,2,3}+' + 'A1+'.repeat(1000) + '1',
    ]
    formulas.forEach((formula, i) => engine.setCell(0, 20 + i, 20, { formula }))
    engine.recalc()
    expect(engine.getValue(0, 20, 20)).toEqual(expect.objectContaining({ code: '#NUM!' }))
    expect(engine.getValue(0, 21, 20)).toEqual(expect.objectContaining({ code: '#SPILL!' }))
    expect(engine.getValue(0, 23, 20)).toBe(1048576)
    expect(engine.getValue(0, 24, 20)).toEqual(expect.objectContaining({ code: '#NUM!' }))
  })
})
