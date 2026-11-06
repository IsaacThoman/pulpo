import { describe, expect, it } from 'vitest'
import { parseCellName } from '../address.js'
import { epochMsToSerial } from '../dates.js'
import { EVALUATOR_FUNCTIONS } from './builtins.js'
import { FormulaEngine, type CellInput, type FormulaEngineOptions } from './engine.js'
import { testFunctions } from './testing.js'
import { isError, matrixFromRows, type Scalar } from './types.js'

function seeded(seed = 42): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
}

const NOW = Date.UTC(2024, 0, 15, 12, 0, 0)

function workbook(options: Partial<FormulaEngineOptions> = {}, sheets = ['Sheet1', 'Sheet2']): Book {
  const engine = new FormulaEngine({ functions: testFunctions(), now: () => NOW, random: seeded(), ...options })
  engine.setSheets(sheets)
  return new Book(engine)
}

/** A1-addressed helpers over the engine. `Sheet2!B3` style addresses pick the sheet. */
class Book {
  constructor(readonly engine: FormulaEngine) {}

  private at(address: string): [number, number, number] {
    const [sheetName, cell] = address.includes('!') ? address.split('!') : ['Sheet1', address]
    const sheet = this.engine.sheetNames.indexOf(sheetName!)
    const parsed = parseCellName(cell!)
    if (sheet < 0 || !parsed) throw new Error(`bad address ${address}`)
    return [sheet, parsed.row, parsed.col]
  }

  set(address: string, content: Scalar | CellInput): this {
    const input: CellInput = content !== null && typeof content === 'object' && !isError(content) ? content : typeof content === 'string' && content.startsWith('=') ? { formula: content.slice(1) } : { value: content as Scalar }
    this.engine.setCell(...this.at(address), input)
    return this
  }

  clear(address: string): this {
    this.engine.setCell(...this.at(address), undefined)
    return this
  }

  recalc(full = false): string[] {
    const sheets = this.engine.sheetNames
    return this.engine
      .recalc({ full })
      .changed.map(({ sheet, row, col }) => `${sheet === 0 ? '' : `${sheets[sheet]}!`}${String.fromCharCode(65 + col)}${row + 1}`)
      .sort()
  }

  get(address: string): unknown {
    const value = this.engine.getValue(...this.at(address))
    return isError(value) ? value.code : value
  }

  calc(address: string): unknown {
    this.recalc()
    return this.get(address)
  }

  column(address: string, count: number): unknown[] {
    const [sheet, row, col] = this.at(address)
    const out: unknown[] = []
    for (let i = 0; i < count; i++) {
      const value = this.engine.getValue(sheet, row + i, col)
      out.push(isError(value) ? value.code : value)
    }
    return out
  }
}

describe('FormulaEngine basics', () => {
  it('calculates and recalculates incrementally', () => {
    const book = workbook().set('A1', 1).set('B1', '=A1*2').set('C1', '=B1+A1').set('D1', '=5')
    expect(book.recalc()).toEqual(['B1', 'C1', 'D1'])
    expect([book.get('B1'), book.get('C1'), book.get('D1')]).toEqual([2, 3, 5])
    book.set('A1', 10)
    expect(book.recalc()).toEqual(['B1', 'C1'])
    expect(book.get('C1')).toBe(30)
    expect(book.recalc()).toEqual([])
  })

  it('treats blanks as 0 in results and arithmetic', () => {
    const book = workbook().set('B1', '=A1').set('C1', '=A1&""')
    book.recalc()
    expect(book.get('B1')).toBe(0)
    expect(book.get('C1')).toBe('')
  })

  it('updates dependents of cleared cells and replaced formulas', () => {
    const book = workbook().set('A1', 3).set('B1', '=A1+1')
    expect(book.calc('B1')).toBe(4)
    book.clear('A1')
    expect(book.calc('B1')).toBe(1)
    book.set('A1', '=2*3')
    expect(book.calc('B1')).toBe(7)
    book.set('A1', 'x')
    expect(book.calc('B1')).toBe('#VALUE!')
  })

  it('reports parse errors as #NAME? and exposes them', () => {
    const book = workbook().set('A1', '=1+*2').set('A2', '=' + '1+'.repeat(4100) + '1').set('A3', '=' + 'ABS('.repeat(65) + '1' + ')'.repeat(65))
    book.recalc()
    expect(book.get('A1')).toBe('#NAME?')
    expect(book.get('A2')).toBe('#NAME?')
    expect(book.get('A3')).toBe('#NAME?')
    expect(book.engine.getParseError(0, 0, 0)?.message).toBeTruthy()
    expect(book.engine.isUnsupported(0, 0, 0)).toBe(true)
  })

  it('evaluates long flat operator chains without recursion', () => {
    const book = workbook().set('A1', '=' + '1+'.repeat(4000) + '1')
    expect(book.calc('A1')).toBe(4001)
  })

  it('evaluates sheet-qualified and 3D references', () => {
    const book = workbook({}, ['Sheet1', 'Sheet2', 'Sheet3']).set('Sheet2!A1', 2).set('Sheet3!A1', 3).set('A1', 1)
    book.set('B1', '=Sheet2!A1*10').set('B2', '=SUM(Sheet1:Sheet3!A1)').set('B3', "='Sheet3'!A1").set('B4', '=Gone!A1')
    book.recalc()
    expect([book.get('B1'), book.get('B2'), book.get('B3'), book.get('B4')]).toEqual([20, 6, 3, '#REF!'])
    book.set('Sheet3!A1', 30)
    expect(book.recalc()).toEqual(['B2', 'B3'])
    expect(book.get('B2')).toBe(33)
  })

  it('re-resolves sheet references on rename and keeps data on reorder', () => {
    const book = workbook().set('Sheet2!A1', 5).set('A1', '=Sheet2!A1')
    expect(book.calc('A1')).toBe(5)
    book.engine.setSheets(['Sheet1', 'Data'])
    expect(book.calc('A1')).toBe('#REF!')
    expect(book.get('Data!A1')).toBe(5)
    book.set('A2', '=Data!A1+1')
    expect(book.calc('A2')).toBe(6)
    book.engine.setSheets(['Data', 'Sheet1'])
    book.recalc()
    expect(book.get('Sheet1!A2')).toBe(6)
    expect(book.get('Data!A1')).toBe(5)
    book.engine.setSheets(['Sheet1'])
    expect(book.calc('A2')).toBe('#REF!')
  })

  it('evaluates ad-hoc formulas in a cell context', () => {
    const book = workbook().set('A1', 4).set('A2', 6)
    expect(book.engine.evaluateFormula('=A1*2')).toBe(8)
    expect(book.engine.evaluateFormula('ROW()', 0, 9, 0)).toBe(10)
    expect(book.engine.evaluateFormula('A1:A2*2')).toEqual(matrixFromRows([[8], [12]]))
  })
})

describe('dynamic arrays', () => {
  it('spills, and spilled cells are readable', () => {
    const book = workbook().set('A1', '=SEQUENCE(3)').set('B1', '=A2*10').set('C1', '=SUM(A1#)').set('D1', '=ROWS(A1#)')
    book.recalc()
    expect(book.column('A1', 4)).toEqual([1, 2, 3, null])
    expect(book.engine.getSpill(0, 0, 0)).toEqual({ rows: 3, cols: 1 })
    expect(book.engine.getSpillAnchor(0, 2, 0)).toEqual({ row: 0, col: 0, array: false })
    expect([book.get('B1'), book.get('C1'), book.get('D1')]).toEqual([20, 6, 3])
  })

  it('blocks spills with #SPILL! and recovers when unblocked', () => {
    const book = workbook().set('A1', '=SEQUENCE(3)').set('C1', '=SUM(A1#)').set('D1', '=A3')
    book.recalc()
    book.set('A3', 'x')
    book.recalc()
    expect(book.get('A1')).toBe('#SPILL!')
    expect(book.get('A2')).toBe(null)
    expect(book.get('C1')).toBe('#REF!')
    expect(book.get('D1')).toBe('x')
    book.clear('A3')
    book.recalc()
    expect(book.column('A1', 3)).toEqual([1, 2, 3])
    expect(book.get('C1')).toBe(6)
    expect(book.get('D1')).toBe(3)
  })

  it('re-dirties readers when a spill grows or shrinks', () => {
    const book = workbook().set('Z1', 2).set('A1', '=SEQUENCE(Z1)').set('B1', '=A4').set('C1', '=SUM(A1:A10)').set('D1', '=COUNT(A1#)')
    book.recalc()
    expect([book.get('B1'), book.get('C1'), book.get('D1')]).toEqual([0, 3, 2])
    book.set('Z1', 5)
    const changed = book.recalc()
    expect([book.get('B1'), book.get('C1'), book.get('D1')]).toEqual([4, 15, 5])
    expect(changed).toEqual(expect.arrayContaining(['A3', 'A4', 'A5', 'B1', 'C1', 'D1']))
    book.set('Z1', 1)
    book.recalc()
    expect(book.column('A1', 5)).toEqual([1, null, null, null, null])
    expect(book.engine.getSpill(0, 0, 0)).toBeUndefined()
    expect([book.get('B1'), book.get('C1')]).toEqual([0, 1])
  })

  it('blocks a spill over another spill and resolves when it moves', () => {
    const book = workbook().set('A2', '=SEQUENCE(1,3)').set('A1', '=SEQUENCE(3)')
    book.recalc()
    // Exactly one of the two wins; the other shows #SPILL!.
    const errors = [book.get('A1'), book.get('A2')].filter((value) => value === '#SPILL!')
    expect(errors).toHaveLength(1)
    book.clear('A2')
    book.recalc()
    expect(book.column('A1', 3)).toEqual([1, 2, 3])
  })

  it('lifts scalar functions and operators over ranges', () => {
    const book = workbook().set('A1', -1).set('A2', -2).set('A3', 3)
    book.set('B1', '=ABS(A1:A3)').set('C1', '=A1:A3*{10,100}').set('E1', '=SEQUENCE({2,3})')
    book.recalc()
    expect(book.column('B1', 3)).toEqual([1, 2, 3])
    expect(book.column('C1', 3)).toEqual([-10, -20, 30])
    expect(book.column('D1', 3)).toEqual([-100, -200, 300])
    expect(book.get('E1')).toBe('#CALC!')
  })

  it('applies implicit intersection for @ and for legacy formulas', () => {
    const book = workbook().set('A1', 1).set('A2', 2).set('A3', 3)
    book.set('B2', '=@A1:A3').set('C2', { formula: 'A1:A3*10', legacy: true }).set('D3', '=A1:A3*10')
    book.set('E5', { formula: 'A1:A3', legacy: true }).set('F2', { formula: 'SUM(A1:A3*2)', legacy: true })
    book.recalc()
    expect(book.get('B2')).toBe(2)
    expect(book.get('C2')).toBe(20)
    expect(book.engine.getSpill(0, 1, 2)).toBeUndefined()
    expect(book.column('D3', 3)).toEqual([10, 20, 30])
    expect(book.get('E5')).toBe('#VALUE!')
    // Array-accepting arguments are calculated as arrays even in legacy formulas.
    expect(book.get('F2')).toBe(12)
  })

  it('fills legacy array formula ranges', () => {
    const book = workbook().set('A1', { formula: '{1,2;3,4}*10', array: { rows: 2, cols: 3 } }).set('A4', { formula: '7', array: { rows: 1, cols: 2 } })
    book.set('D1', '=SUM(A1:B2)').set('A3', { formula: 'SEQUENCE(1,2)', array: { rows: 2, cols: 2 } })
    book.recalc()
    expect([book.get('A1'), book.get('B1'), book.get('C1'), book.get('A2'), book.get('B2'), book.get('C2')]).toEqual([10, 20, '#N/A', 30, 40, '#N/A'])
    expect([book.get('A4'), book.get('B4')]).toEqual([7, 7])
    expect([book.get('A3'), book.get('B3')]).toEqual([1, 2])
    expect(book.get('D1')).toBe(100)
    expect(book.engine.getSpillAnchor(0, 1, 1)).toEqual({ row: 0, col: 0, array: true })
    expect(book.engine.getSpill(0, 0, 0)).toBeUndefined()
  })
})

describe('circular references', () => {
  it('evaluates cycles to 0 and reports them', () => {
    const book = workbook().set('A1', '=B1+1').set('B1', '=A1+1').set('C1', '=A1+5').set('D1', '=D1+1').set('E1', '=SUM(E:E)')
    book.recalc()
    expect([book.get('A1'), book.get('B1'), book.get('C1'), book.get('D1'), book.get('E1')]).toEqual([0, 0, 5, 0, 0])
    expect(book.engine.isCircular(0, 0, 0)).toBe(true)
    expect(book.engine.isCircular(0, 0, 1)).toBe(true)
    expect(book.engine.isCircular(0, 0, 2)).toBe(false)
    expect(book.engine.isCircular(0, 0, 3)).toBe(true)
    expect(book.engine.isCircular(0, 0, 4)).toBe(true)
    expect(book.engine.circularCells()).toHaveLength(4)
    book.set('B1', 10)
    book.recalc()
    expect([book.get('A1'), book.get('C1')]).toEqual([11, 16])
    expect(book.engine.isCircular(0, 0, 0)).toBe(false)
  })

  it('detects cycles only visible at run time', () => {
    const book = workbook().set('A1', '=INDIRECT("B1")').set('B1', '=A1+1')
    book.recalc()
    expect(book.engine.isCircular(0, 0, 0) || book.engine.isCircular(0, 0, 1)).toBe(true)
  })

  it('marks only the cells on a run-time cycle as circular', () => {
    const book = workbook().set('A1', '=SUM(INDIRECT("B1:B3"))').set('B1', '=1+0').set('B2', '=A1+1').set('B3', '=2+0')
    book.recalc()
    expect([book.get('B1'), book.get('B3')]).toEqual([1, 2])
    expect([book.engine.isCircular(0, 0, 1), book.engine.isCircular(0, 2, 1)]).toEqual([false, false])
    expect([book.engine.isCircular(0, 0, 0), book.engine.isCircular(0, 1, 1)]).toEqual([true, true])
  })

  it('iterates when iterative calculation is on', () => {
    const book = workbook({ iterative: { maxIterations: 100, maxChange: 0.000001 } }).set('A1', '=A1/2+1')
    book.recalc()
    expect(book.get('A1') as number).toBeCloseTo(2, 4)
    const loop = workbook({ iterative: { maxIterations: 10, maxChange: 0 } }).set('A1', '=B1+1').set('B1', '=A1')
    loop.recalc()
    expect(loop.get('A1')).toBe(10)
  })
})

describe('volatile functions and time', () => {
  it('recalculates volatile cells and their dependents every time', () => {
    const book = workbook().set('A1', '=RAND()').set('B1', '=A1*1').set('C1', '=1+1')
    book.recalc()
    const first = book.get('B1')
    expect(book.recalc()).toEqual(['A1', 'B1'])
    expect(book.get('B1')).not.toBe(first)
    expect(book.get('A1')).toBe(book.get('B1'))
  })

  it('makes OFFSET, INDIRECT, CELL, INFO volatile', () => {
    const book = workbook().set('A1', 1).set('B1', '=SUM(OFFSET(A1,0,0,3))').set('C1', '=INDIRECT("A2")').set('D1', '=CELL("row",A1)').set('E1', '=INFO("numfile")')
    book.recalc()
    expect(book.recalc()).toEqual([])
    book.set('A2', 5)
    book.recalc()
    expect([book.get('B1'), book.get('C1'), book.get('D1'), book.get('E1')]).toEqual([6, 5, 1, 2])
  })

  it('gives NOW in local time, stable within a recalc', () => {
    const book = workbook().set('A1', '=NOW()').set('A2', '=NOW()-A1')
    book.recalc()
    const local = NOW - new Date(NOW).getTimezoneOffset() * 60_000
    expect(book.get('A1')).toBeCloseTo(epochMsToSerial(local), 8)
    expect(book.get('A2')).toBe(0)
  })
})

describe('names', () => {
  it('resolves constants, ranges, and formulas', () => {
    const book = workbook().set('A1', 1).set('A2', 2).set('A3', 3)
    book.engine.setName('Rate', '0.1')
    book.engine.setName('Data', 'Sheet1!$A$1:$A$3')
    book.engine.setName('Total', 'SUM(Data)')
    book.set('B1', '=100*rate').set('B2', '=SUM(Data)').set('B3', '=Total*2').set('B4', '=Missing+1').set('B5', '=ROWS(Data)')
    book.recalc()
    expect([book.get('B1'), book.get('B2'), book.get('B3'), book.get('B4'), book.get('B5')]).toEqual([10, 6, 12, '#NAME?', 3])
    book.engine.setName('Rate', '0.2')
    book.engine.setName('Missing', '41')
    book.recalc()
    expect([book.get('B1'), book.get('B4')]).toEqual([20, 42])
    book.set('A1', 10)
    expect(book.recalc()).toEqual(['B2', 'B3'])
    expect(book.get('B3')).toBe(30)
    book.engine.setName('Rate', undefined)
    expect(book.calc('B1')).toBe('#NAME?')
  })

  it('prefers sheet-scoped names', () => {
    const book = workbook()
    book.engine.setName('X', '1')
    book.engine.setName('X', '2', 1)
    book.set('A1', '=X').set('Sheet2!A1', '=X').set('A2', '=Sheet2!X')
    book.recalc()
    expect([book.get('A1'), book.get('Sheet2!A1'), book.get('A2')]).toEqual([1, 2, 2])
  })

  it('calls names defined as LAMBDAs, recursively too', () => {
    const book = workbook()
    book.engine.setName('Double', 'LAMBDA(x,x*2)')
    book.engine.setName('Fact', 'LAMBDA(n,IF(n<=1,1,n*Fact(n-1)))')
    book.engine.setName('Forever', 'LAMBDA(n,Forever(n+1))')
    book.set('A1', '=Double(4)').set('A2', '=Fact(10)').set('A3', '=Forever(1)').set('A4', '=Undefined(1)')
    book.recalc()
    expect([book.get('A1'), book.get('A2'), book.get('A3'), book.get('A4')]).toEqual([8, 3628800, '#NUM!', '#NAME?'])
    expect(book.engine.usesUnknownFunction(0, 3, 0)).toBe(true)
    expect(book.engine.usesUnknownFunction(0, 0, 0)).toBe(false)
    book.engine.setName('Undefined', 'LAMBDA(x,x+0.5)')
    book.recalc()
    expect(book.get('A4')).toBe(1.5)
    expect(book.engine.usesUnknownFunction(0, 3, 0)).toBe(false)
  })
})

describe('tables', () => {
  function sales() {
    const book = workbook()
    book.set('A1', 'Item').set('B1', 'Amount').set('A2', 'a').set('B2', 10).set('A3', 'b').set('B3', 20).set('A4', 'Total').set('B4', '=SUBTOTAL_NOT_USED')
    book.clear('B4')
    book.engine.setTables([{ name: 'Sales', sheet: 0, top: 0, left: 0, bottom: 3, right: 2, headerRow: true, totalsRow: true, columns: ['Item', 'Amount', 'Double'] }])
    return book
  }

  it('resolves structured references', () => {
    const book = sales()
    book.set('C2', '=[@Amount]*2').set('C3', '=Sales[@[Amount]]*2').set('B4', '=SUM(Sales[Amount])')
    book.set('E1', '=ROWS(Sales[#All])').set('E2', '=Sales[[#Headers],[Item]]').set('E3', '=ROWS(Sales)').set('E4', '=SUM(Sales[[#Totals],[Amount]])')
    book.set('E5', '=COLUMNS(Sales[[Item]:[Amount]])').set('E6', '=Sales[Nope]').set('E7', '=Other[A]').set('E8', '=[@Amount]')
    book.recalc()
    expect([book.get('C2'), book.get('C3'), book.get('B4')]).toEqual([20, 40, 30])
    expect([book.get('E1'), book.get('E2'), book.get('E3'), book.get('E4'), book.get('E5'), book.get('E6'), book.get('E7'), book.get('E8')]).toEqual([4, 'Item', 2, 30, 2, '#REF!', '#REF!', '#REF!'])
    book.set('B2', 100)
    expect(book.recalc()).toEqual(['B4', 'C2', 'E4'])
  })

  it('rebinds when tables change', () => {
    const book = sales()
    book.set('E1', '=SUM(Sales[Amount])')
    expect(book.calc('E1')).toBe(30)
    book.engine.setTables([{ name: 'Sales', sheet: 0, top: 0, left: 0, bottom: 2, right: 2, headerRow: true, totalsRow: false, columns: ['Item', 'Amount', 'Double'] }])
    expect(book.calc('E1')).toBe(30)
    book.engine.setTables([])
    expect(book.calc('E1')).toBe('#REF!')
  })
})

describe('LET, LAMBDA and the lambda helpers', () => {
  it.each<[string, unknown]>([
    ['=LET(x,2,y,x*3,x+y)', 8],
    ['=LET(_xlpm.x,2,_xlpm.x*5)', 10],
    ['=LET(r,A1:A3,ROWS(r))', 3],
    ['=LET(x,1,LET(x,2,x)+x)', 3],
    ['=LAMBDA(x,x+1)(2)', 3],
    ['=LAMBDA(x,y,x*y)(3,4)', 12],
    ['=LAMBDA(x,x)', '#CALC!'],
    ['=LAMBDA(x,x)(1,2)', '#VALUE!'],
    ['=LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(1)', 1],
    ['=LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(1,2)', 3],
    ['=LAMBDA(x,y,ISOMITTED(y))(1,)', true],
    ['=LET(f,LAMBDA(n,n*10),f(4))', 40],
    ['=REDUCE(0,A1:A3,LAMBDA(a,b,a+b))', 6],
    ['=REDUCE(,A1:A3,LAMBDA(a,b,a+b))', 6],
    ['=SUM(SCAN(0,A1:A3,LAMBDA(a,b,a+b)))', 10],
    ['=SUM(MAP(A1:A3,LAMBDA(v,v*v)))', 14],
    ['=SUM(MAP(A1:A3,{10;20;30},LAMBDA(a,b,a*b)))', 140],
    ['=SUM(BYROW(A1:B3,LAMBDA(r,SUM(r))))', 6 + 60],
    ['=SUM(BYCOL(A1:B3,LAMBDA(c,MAX(c))))', 3 + 30],
    ['=SUM(MAKEARRAY(2,3,LAMBDA(r,c,r*c)))', 18],
    ['=ROWS(REDUCE(0,{1,2,3},LAMBDA(a,b,VSTACK(a,b))))', 4],
    ['=MAP(A1:A2,LAMBDA(v,SEQUENCE(2)))', '#CALC!'],
    ['=MAP(A1:A3,1)', '#VALUE!'],
    ['=MAKEARRAY(0,1,LAMBDA(r,c,1))', '#VALUE!'],
  ])('%s', (formula, expected) => {
    const book = workbook().set('A1', 1).set('A2', 2).set('A3', 3).set('B1', 10).set('B2', 20).set('B3', 30).set('D1', formula)
    expect(book.calc('D1')).toBe(expected)
  })

  it('spills lambda helper results', () => {
    const book = workbook().set('A1', 1).set('A2', 2).set('C1', '=SCAN(0,A1:A2,LAMBDA(a,b,a+b))').set('D1', '=MAKEARRAY(1,2,LAMBDA(r,c,c))')
    book.recalc()
    expect(book.column('C1', 2)).toEqual([1, 3])
    expect([book.get('D1'), book.get('E1')]).toEqual([1, 2])
  })
})

describe('conditionals', () => {
  it.each<[string, unknown]>([
    ['=IF(TRUE,1,2)', 1],
    ['=IF(FALSE,1)', false],
    ['=IF(TRUE,,2)', 0],
    ['=IF("TRUE",1,2)', 1],
    ['=IF("x",1,2)', '#VALUE!'],
    ['=IF(#N/A,1,2)', '#N/A'],
    ['=IF(A1>1,1/0,"ok")', 'ok'],
    ['=SUM(IF(A1:A3>1,A1:A3,0))', 5],
    ['=SUM(IF(TRUE,A1:A3))', 6],
    ['=IFS(A1>5,"a",A1>0,"b")', 'b'],
    ['=IFS(FALSE,1)', '#N/A'],
    ['=SUM(IFS(A1:A3>2,100,TRUE,1))', 102],
    ['=IFERROR(1/0,"x")', 'x'],
    ['=IFERROR(5,1/0)', 5],
    ['=SUM(IFERROR(1/(A1:A3-2),100))', 100],
    ['=IFNA(NA(),"n")', 'n'],
    ['=IFNA(1/0,"n")', '#DIV/0!'],
    ['=SWITCH(2,1,"a",2,"b","z")', 'b'],
    ['=SWITCH("B","a",1,"b",2)', 2],
    ['=SWITCH(9,1,"a","z")', 'z'],
    ['=SWITCH(9,1,"a")', '#N/A'],
    ['=CHOOSE(2,"a","b","c")', 'b'],
    ['=CHOOSE(4,"a","b")', '#VALUE!'],
    ['=SUM(CHOOSE(2,A1:A2,A2:A3))', 5],
    ['=SUM(CHOOSE({1,2},10,20))', 30],
  ])('%s', (formula, expected) => {
    const book = workbook().set('A1', 1).set('A2', 2).set('A3', 3).set('D1', formula)
    expect(book.calc('D1')).toBe(expected)
  })
})

describe('reference functions', () => {
  it.each<[string, unknown]>([
    ['=SUM(INDEX(A:A,1):INDEX(A:A,3))', 6],
    ['=INDEX(A1:C3,2,3)', 22],
    ['=INDEX(A1:C1,2)', 11],
    ['=INDEX(A1:A3,3)', 3],
    ['=SUM(INDEX(A1:C3,0,2))', 36],
    ['=SUM(INDEX(A1:C3,2,0))', 2 + 12 + 22],
    ['=INDEX(A1:C3,4,1)', '#REF!'],
    ['=INDEX((A1:A3,C1:C3),1,1,2)', 21],
    ['=INDEX((A1:A3,C1:C3),1,1,3)', '#REF!'],
    ['=INDEX({1,2;3,4},2,1)', 3],
    ['=SUM(INDEX({1,2;3,4},0,2))', 6],
    ['=SUM(INDEX(A1:A3,{1,3}))', 4],
    ['=ROWS(INDEX(A1:C3,2,0))', 1],
    ['=OFFSET(A1,1,2)', 22],
    ['=SUM(OFFSET(A1,0,0,2,2))', 1 + 2 + 11 + 12],
    ['=OFFSET(A1,-1,0)', '#REF!'],
    ['=OFFSET(A1,0,0,0,1)', '#REF!'],
    ['=ROWS(OFFSET(A1:B2,1,1))', 2],
    ['=INDIRECT("A"&2)', 2],
    ['=INDIRECT("Sheet2!B1")', 'other'],
    ['=SUM(INDIRECT("A1:A3"))', 6],
    ['=INDIRECT("R2C3",FALSE)', 22],
    ['=INDIRECT("R[1]C[-3]",FALSE)', 2],
    ['=INDIRECT("nonsense+")', '#REF!'],
    ['=INDIRECT("1+1")', '#REF!'],
    ['=ROW()', 1],
    ['=ROW(C5)', 5],
    ['=SUM(ROW(A1:A3))', 6],
    ['=COLUMN(C1)', 3],
    ['=SUM(COLUMN(C1:D1))', 7],
    ['=ROW(D1:D2)', 1],
    ['=COLUMN(D1:E1)', '#SPILL!'],
    ['=COLUMNS(A1:C3)', 3],
    ['=ROWS(A:A)', 1048576],
    ['=COLUMNS(1:1)', 16384],
    ['=ROWS({1;2;3})', 3],
    ['=AREAS((A1,B2:C3))', 2],
    ['=ISREF(A1)', true],
    ['=ISREF(1)', false],
    ['=ISREF(INDEX(A1:A3,1))', true],
    ['=ISFORMULA(E1)', true],
    ['=ISFORMULA(A1)', false],
    ['=FORMULATEXT(E1)', '=A1*2'],
    ['=FORMULATEXT(A1)', '#N/A'],
    ['=CELL("address",B2)', '$B$2'],
    ['=CELL("address",Sheet2!B2)', 'Sheet2!$B$2'],
    ['=CELL("contents",C2)', 22],
    ['=CELL("type",A9)', 'b'],
    ['=CELL("type",Sheet2!B1)', 'l'],
    ['=CELL("col")', 4],
    ['=CELL("bogus")', '#VALUE!'],
    ['=SHEET()', 1],
    ['=SHEET(Sheet2!A1)', 2],
    ['=SHEET("Sheet2")', 2],
    ['=SHEET("nope")', '#N/A'],
    ['=SHEETS()', 2],
    ['=SHEETS(Sheet1:Sheet2!A1)', 2],
    ['=INFO("recalc")', 'Automatic'],
  ])('%s', (formula, expected) => {
    const book = workbook()
    for (let r = 0; r < 3; r++) {
      book.set(`A${r + 1}`, r + 1)
      book.set(`B${r + 1}`, 11 + r)
      book.set(`C${r + 1}`, 21 + r)
    }
    book.set('Sheet2!B1', 'other').set('E1', '=A1*2').set('D1', formula)
    expect(book.calc('D1')).toBe(expected)
  })

  it('tracks dependencies only known at run time', () => {
    const book = workbook().set('A1', 1).set('B1', 10).set('B2', 20).set('B3', 30)
    book.set('D1', '=SUM(INDEX(A:A,1):B3)')
    expect(book.calc('D1')).toBe(61)
    expect(book.engine.precedents(0, 0, 3)).toEqual(expect.arrayContaining([{ sheet: 0, top: 0, left: 0, bottom: 2, right: 1 }]))
    book.set('B2', 25)
    expect(book.recalc()).toEqual(['D1'])
    expect(book.get('D1')).toBe(66)
  })

  it('evaluates in the right order when precedents are only known at run time', () => {
    // C1 reads A1 through INDEX on a range that also contains a pending formula.
    const book = workbook().set('A1', '=B1*2').set('B1', 1).set('C1', '=INDEX(A1:A5,1)+0')
    expect(book.calc('C1')).toBe(2)
    book.set('B1', 5)
    expect(book.calc('C1')).toBe(10)
  })
})

describe('cached values and unsupported formulas', () => {
  it('keeps cached values until something changes', () => {
    const book = workbook().set('A1', 2).set('B1', { formula: 'A1*2', cached: 999 })
    book.engine.markClean()
    expect(book.get('B1')).toBe(999)
    expect(book.engine.hasCachedValue(0, 0, 1)).toBe(true)
    expect(book.recalc()).toEqual([])
    expect(book.get('B1')).toBe(999)
    book.set('A1', 3)
    book.recalc()
    expect(book.get('B1')).toBe(6)
    expect(book.engine.hasCachedValue(0, 0, 1)).toBe(false)
  })

  it('recalculates cached cells on a full recalc', () => {
    const book = workbook().set('A1', 2).set('B1', { formula: 'A1*2', cached: 999 })
    book.engine.markClean()
    book.recalc(true)
    expect(book.get('B1')).toBe(4)
  })

  it('keeps cached values for unknown functions and external references', () => {
    const book = workbook().set('A1', 1)
    book.set('B1', { formula: 'MYUDF(A1)', cached: 'from excel' }).set('B2', { formula: '[1]Sheet1!A1+A1', cached: 7 }).set('B3', '=MYUDF(A1)').set('B4', '=B1&"!"')
    book.set('B5', { formula: '_xludf.FN(1)', cached: 3 }).set('B6', { formula: 'SUM(', cached: 4 })
    book.recalc(true)
    expect([book.get('B1'), book.get('B2'), book.get('B3'), book.get('B4'), book.get('B5'), book.get('B6')]).toEqual(['from excel', 7, '#NAME?', 'from excel!', 3, 4])
    expect(book.engine.usesUnknownFunction(0, 0, 1)).toBe(true)
    expect(book.engine.usesExternalReference(0, 1, 1)).toBe(true)
    expect(book.engine.isUnsupported(0, 5, 1)).toBe(true)
    book.set('A1', 2)
    book.recalc()
    expect(book.get('B1')).toBe('from excel')
  })

  it('lets callers keep cached values for other cells', () => {
    const book = workbook().set('A1', 1).set('B1', { formula: 'A1+1', cached: 50 }).set('B2', { formula: 'A1+1', cached: 50 })
    book.engine.recalc({ full: true, keepCachedFor: (_sheet, row) => row === 0 })
    expect([book.get('B1'), book.get('B2')]).toEqual([50, 2])
  })

  it('serves cached spills and array results before the first recalc', () => {
    const book = workbook()
      .set('A1', { formula: 'SEQUENCE(3)', cached: matrixFromRows([[1], [2], [3]]) })
      .set('C1', { formula: '{1,2}', array: { rows: 1, cols: 2 }, cached: matrixFromRows([[5, 6]]) })
    book.engine.markClean()
    expect(book.column('A1', 3)).toEqual([1, 2, 3])
    expect([book.get('C1'), book.get('D1')]).toEqual([5, 6])
    book.recalc(true)
    expect([book.get('C1'), book.get('D1')]).toEqual([1, 2])
  })
})

describe('scale and stack safety', () => {
  it('handles a 100,000-cell dependency chain without overflowing the stack', () => {
    const book = workbook()
    const n = 100_000
    // Set in reverse so evaluation order cannot follow insertion order.
    for (let row = n - 1; row >= 1; row--) book.engine.setCell(0, row, 0, { formula: `A${row}+1` })
    book.engine.setCell(0, 0, 0, { value: 1 })
    book.recalc()
    expect(book.engine.getValue(0, n - 1, 0)).toBe(n)
    book.engine.setCell(0, 0, 0, { value: 2 })
    book.engine.recalc()
    expect(book.engine.getValue(0, n - 1, 0)).toBe(n + 1)
  })

  it('handles a 100,000-cell cycle', () => {
    const book = workbook()
    const n = 100_000
    for (let row = 0; row < n; row++) book.engine.setCell(0, row, 0, { formula: `A${((row + 1) % n) + 1}+1` })
    book.recalc()
    expect(book.engine.getValue(0, 500, 0)).toBe(0)
    expect(book.engine.isCircular(0, 500, 0)).toBe(true)
  })

  it('keeps incremental results equal to a full recalc (randomized)', () => {
    const random = seeded(7)
    const pick = (n: number) => Math.floor(random() * n)
    const ROWS = 8
    const COLS = 4
    const cell = () => `${String.fromCharCode(65 + pick(COLS))}${pick(ROWS) + 1}`
    const range = () => {
      const a = parseCellName(cell())!
      const b = parseCellName(cell())!
      return `${String.fromCharCode(65 + Math.min(a.col, b.col))}${Math.min(a.row, b.row) + 1}:${String.fromCharCode(65 + Math.max(a.col, b.col))}${Math.max(a.row, b.row) + 1}`
    }
    const formulas = [
      () => `${cell()}+${cell()}`,
      () => `SUM(${range()})`,
      () => `IF(${cell()}>5,${cell()},${pick(10)})`,
      () => `${cell()}*2-${pick(5)}`,
      () => `INDEX(${range()},1,1)+1`,
      () => `COUNT(${range()})`,
      () => `SEQUENCE(${1 + pick(3)})`,
      () => `LET(x,${cell()},x*x)`,
      () => `IFERROR(1/${cell()},0)`,
    ]
    const content = () => (random() < 0.4 ? { value: pick(10) } : random() < 0.95 ? { formula: formulas[pick(formulas.length)]!() } : undefined)
    const live = workbook()
    const state = new Map<string, CellInput>()
    for (let step = 0; step < 300; step++) {
      for (let edit = 0; edit < 1 + pick(3); edit++) {
        const address = cell()
        const input = content()
        state.set(address, input)
        live.set(address, input ?? { value: null })
      }
      live.recalc()
      const fresh = workbook()
      for (const [address, input] of state) fresh.set(address, input ?? { value: null })
      fresh.recalc(true)
      for (let row = 1; row <= ROWS + 3; row++) {
        for (let col = 0; col < COLS + 1; col++) {
          const address = `${String.fromCharCode(65 + col)}${row}`
          expect(`${step} ${address} ${String(live.get(address))}`).toBe(`${step} ${address} ${String(fresh.get(address))}`)
        }
      }
    }
  })
})

describe('evaluator-owned functions', () => {
  it('lists them for the function library', () => {
    expect(EVALUATOR_FUNCTIONS).toEqual(expect.arrayContaining(['IF', 'LET', 'LAMBDA', 'INDEX', 'OFFSET', 'INDIRECT', 'MAP', 'REDUCE']))
    expect(EVALUATOR_FUNCTIONS).not.toContain('AND')
  })

  it('wins over library functions of the same name', () => {
    const functions = testFunctions()
    functions.set('IF', { name: 'IF', minArgs: 0, maxArgs: 3, fn: () => 'library' })
    const book = workbook({ functions }).set('A1', '=IF(TRUE,1,2)')
    expect(book.calc('A1')).toBe(1)
  })
})
