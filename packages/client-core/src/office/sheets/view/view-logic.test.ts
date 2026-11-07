import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MAX_ROWS, MAX_COLS, type CellRange } from '../address.js'
import { toA1Form } from '../model/formula-ids.js'
import type { ConditionalFormat } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { CachedValues } from '../values.js'
import { applyCompletion, activeCall, argumentHint, canInsertReference, completions, formulaReferences, insertReference, partialFunctionName, type FunctionDoc } from './formula-assist.js'
import * as commands from './commands.js'
import { DEFAULT_THEME_COLORS, applyTint, cssColor } from './colors.js'
import { ConditionalFormatter } from './conditional.js'
import { fillSeries } from './fill.js'
import { AxisLayout, columnWidthToPixels, pixelsToColumnWidth } from './layout.js'

function sheet(): SheetModel {
  const model = WorkbookModel.initialize(new Y.Doc())
  return model.addSheet('Sheet1')
}

function put(target: SheetModel, rows: (string | number | boolean | null)[][]): void {
  rows.forEach((row, r) => row.forEach((value, c) => value !== null && target.setCell(r, c, typeof value === 'string' && value.startsWith('=') ? { f: value.slice(1) } : { v: value })))
}

const values = (target: SheetModel, col: number, rows: number) => Array.from({ length: rows }, (_, row) => target.cell(row, col)?.v ?? null)

describe('commands', () => {
  it('types values, formulas, and inferred number formats', () => {
    const target = sheet()
    commands.setCellInput(target, 0, 0, '50%')
    commands.setCellInput(target, 0, 1, '=SUM(A1:A3)')
    commands.setCellInput(target, 0, 2, "'007")
    commands.setCellInput(target, 0, 3, '')
    expect(target.cell(0, 0)).toEqual({ v: 0.5 })
    expect(toA1Form(target.cell(0, 1)!.f!, target)).toBe('SUM(A1:A3)')
    expect(target.cell(0, 2)).toEqual({ v: '007', t: 's' })
    expect(target.cell(0, 3)).toBeUndefined()
    commands.setCellInput(target, 1, 0, '=A1', { valuesOnly: true })
    expect(target.cell(1, 0)).toEqual({ v: '=A1' })
  })

  it('fills a selection with one input, moving relative references', () => {
    const target = sheet()
    commands.fillInput(target, [{ top: 0, left: 1, bottom: 2, right: 1 }], { row: 0, col: 1 }, '=A1*2')
    expect([0, 1, 2].map((row) => toA1Form(target.cell(row, 1)!.f!, target))).toEqual(['A1*2', 'A2*2', 'A3*2'])
  })

  it('styles whole columns and the cells in them', () => {
    const target = sheet()
    put(target, [[1, 2]])
    commands.applyStyle(target, [{ top: 0, left: 0, bottom: MAX_ROWS - 1, right: 0 }], { bold: true })
    expect(target.axisOverrides('col', target.cols.idAt(0))).toEqual({ bold: true })
    expect(target.cellOverrides(target.keyAt(0, 0))).toEqual({ bold: true })
    expect(target.cellOverrides(target.keyAt(0, 1))).toEqual({})
  })

  it('applies border presets', () => {
    const target = sheet()
    commands.applyBorders(target, [{ top: 0, left: 0, bottom: 1, right: 1 }], 'outer')
    expect(target.cellOverrides(target.keyAt(0, 0))).toEqual({ borderTop: { style: 'thin' }, borderLeft: { style: 'thin' } })
    expect(target.cellOverrides(target.keyAt(1, 1))).toEqual({ borderBottom: { style: 'thin' }, borderRight: { style: 'thin' } })
    commands.applyBorders(target, [{ top: 0, left: 0, bottom: 1, right: 1 }], 'none')
    expect(target.cellOverrides(target.keyAt(0, 0)).borderTop).toBeNull()
  })

  it('merges keeping the first value and expands selections over merges', () => {
    const target = sheet()
    put(target, [['keep', 'drop'], ['drop', 'drop']])
    commands.mergeRanges(target, [{ top: 0, left: 0, bottom: 1, right: 1 }], 'center')
    expect(values(target, 0, 2)).toEqual(['keep', null])
    expect(target.cellOverrides(target.keyAt(0, 0)).hAlign).toBe('center')
    expect(commands.expandToMerges({ top: 1, left: 1, bottom: 1, right: 2 }, target.mergedRanges().map((merge) => merge.range))).toEqual({ top: 0, left: 0, bottom: 1, right: 2 })
    commands.unmergeRanges(target, [{ top: 1, left: 1, bottom: 1, right: 1 }])
    expect(target.mergedRanges()).toEqual([])
  })

  it('sorts like Excel: numbers, then text, then booleans, blanks last, keeping formats', () => {
    const target = sheet()
    put(target, [['b'], [3], [null], [true], ['A'], [1]])
    target.setStyle({ top: 1, left: 0, bottom: 1, right: 0 }, { bold: true })
    commands.sortRange(target, { top: 0, left: 0, bottom: 5, right: 0 }, [{ col: 0 }], (row, col) => target.cell(row, col)?.v ?? null)
    expect(values(target, 0, 6)).toEqual([1, 3, 'A', 'b', true, null])
    expect(target.cellOverrides(target.keyAt(1, 0)).bold).toBe(true)
    commands.sortRange(target, { top: 0, left: 0, bottom: 5, right: 0 }, [{ col: 0, descending: true }], (row, col) => target.cell(row, col)?.v ?? null)
    expect(values(target, 0, 6)).toEqual([true, 'b', 'A', 3, 1, null])
  })

  it('moves relative references when sorting rows with formulas', () => {
    const target = sheet()
    put(target, [[2, '=A1*10'], [1, '=A2*10']])
    commands.sortRange(target, { top: 0, left: 0, bottom: 1, right: 1 }, [{ col: 0 }], (row, col) => target.cell(row, col)?.v ?? null)
    expect(values(target, 0, 2)).toEqual([1, 2])
    expect([0, 1].map((row) => toA1Form(target.cell(row, 1)!.f!, target))).toEqual(['A1*10', 'A2*10'])
  })

  it('filters rows by shown values and clears filters', () => {
    const target = sheet()
    put(target, [['Fruit'], ['apple'], ['pear'], [null], ['apple']])
    commands.setAutoFilter(target, { top: 0, left: 0, bottom: 4, right: 0 })
    const display = (row: number, col: number) => String(target.cell(row, col)?.v ?? '')
    commands.filterColumn(target, 0, ['apple'], display)
    expect([1, 2, 3, 4].map((row) => !!target.rowProp(row, 'hidden'))).toEqual([false, true, true, false])
    commands.filterColumn(target, 0, ['pear', ''], display)
    expect([1, 2, 3, 4].map((row) => !!target.rowProp(row, 'hidden'))).toEqual([true, false, false, true])
    commands.setAutoFilter(target, undefined)
    expect([1, 2, 3, 4].map((row) => !!target.rowProp(row, 'hidden'))).toEqual([false, false, false, false])
  })

  it('changes decimals in number formats', () => {
    expect(commands.adjustDecimals('General', 1, 1.5)).toBe('0.00')
    expect(commands.adjustDecimals('0.00', -1)).toBe('0.0')
    expect(commands.adjustDecimals('0', -1)).toBe('0')
    expect(commands.adjustDecimals('#,##0.00;[Red]-#,##0.00', 1)).toBe('#,##0.000;[Red]-#,##0.000')
    expect(commands.adjustDecimals('m/d/yyyy', 1)).toBe('m/d/yyyy')
  })

  it('finds validation rules and literal lists', () => {
    const target = sheet()
    commands.setValidation(target, [{ top: 0, left: 0, bottom: 4, right: 0 }], { type: 'list', formula1: '"a, b,c"' })
    expect(commands.literalListItems(commands.validationAt(target, 2, 0)!.formula1)).toEqual(['a', 'b', 'c'])
    commands.setValidation(target, [{ top: 0, left: 0, bottom: 4, right: 0 }], undefined)
    expect(commands.validationAt(target, 2, 0)).toBeUndefined()
  })

  it('clears contents and formats separately', () => {
    const target = sheet()
    put(target, [[1, 2]])
    target.setStyle({ top: 0, left: 0, bottom: 0, right: 1 }, { italic: true })
    commands.clearContents(target, [{ top: 0, left: 0, bottom: 0, right: 0 }])
    expect(target.cell(0, 0)).toBeUndefined()
    expect(target.cellOverrides(target.keyAt(0, 0))).toEqual({ italic: true })
    commands.clearFormats(target, [{ top: 0, left: 0, bottom: MAX_ROWS - 1, right: 1 }])
    expect(target.cellOverrides(target.keyAt(0, 1))).toEqual({})
    expect(target.cell(0, 1)!.v).toBe(2)
  })
})

describe('fill series', () => {
  const sources = (items: (string | number)[], numFmt = 'General') => items.map((value) => ({ value, formula: false, numFmt }))
  const valuesOf = (results: ReturnType<typeof fillSeries>) => results.map((result) => (result.kind === 'value' ? result.value : `copy${result.from}`))

  it('repeats one number, continues trends, and steps dates', () => {
    expect(valuesOf(fillSeries(sources([5]), 3))).toEqual(['copy0', 'copy0', 'copy0'])
    expect(valuesOf(fillSeries(sources([1, 3]), 3))).toEqual([5, 7, 9])
    expect(valuesOf(fillSeries(sources([0.1, 0.2]), 2))).toEqual([0.3, 0.4])
    expect(valuesOf(fillSeries(sources([1, 3]), 2, true))).toEqual([-1, -3])
    expect(valuesOf(fillSeries(sources([45000], 'm/d/yyyy'), 2))).toEqual([45001, 45002])
    // Jan 1 and Feb 1 2023: the same day of month, so months.
    expect(valuesOf(fillSeries(sources([44927, 44958], 'm/d/yyyy'), 1))).toEqual([44986])
    // Two days apart: days.
    expect(valuesOf(fillSeries(sources([44927, 44929], 'm/d/yyyy'), 1))).toEqual([44931])
    // Month steps on the 15th.
    expect(valuesOf(fillSeries(sources([44941, 44972], 'm/d/yyyy'), 2))).toEqual([45000, 45031])
  })

  it('counts up text with numbers and cycles day and month names', () => {
    expect(valuesOf(fillSeries(sources(['Item 9']), 2))).toEqual(['Item 10', 'Item 11'])
    expect(valuesOf(fillSeries(sources(['Q001']), 1))).toEqual(['Q002'])
    expect(valuesOf(fillSeries(sources(['Fri']), 3))).toEqual(['Sat', 'Sun', 'Mon'])
    expect(valuesOf(fillSeries(sources(['JANUARY', 'MARCH']), 2))).toEqual(['MAY', 'JULY'])
    expect(valuesOf(fillSeries(sources(['a', 'b']), 3))).toEqual(['copy0', 'copy1', 'copy0'])
  })

  it('copies formulas', () => {
    expect(valuesOf(fillSeries([{ value: 2, formula: true, numFmt: 'General' }], 2))).toEqual(['copy0', 'copy0'])
  })
})

describe('formula assist', () => {
  const docs: FunctionDoc[] = [
    { name: 'SUM', args: [{ name: 'number1' }, { name: 'number2', optional: true, repeating: true }] },
    { name: 'SUMIF', args: [{ name: 'range' }, { name: 'criteria' }, { name: 'sum_range', optional: true }] },
    { name: 'VLOOKUP', args: [{ name: 'lookup_value' }, { name: 'table_array' }, { name: 'col_index_num' }, { name: 'range_lookup', optional: true }] },
  ]

  it('colors references consistently', () => {
    const refs = formulaReferences('=A1+SUM(B2:C3)+a1+Sheet2!D4')
    expect(refs.map((ref) => ref.range)).toEqual([
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 1, left: 1, bottom: 2, right: 2 },
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 3, left: 3, bottom: 3, right: 3 },
    ])
    expect(refs[0]!.color).toBe(refs[2]!.color)
    expect(refs[0]!.color).not.toBe(refs[1]!.color)
    expect(refs[3]!.sheet).toBe('Sheet2')
  })

  it('completes function names and hints arguments', () => {
    expect(partialFunctionName('=1+su', 5)).toEqual({ prefix: 'su', start: 3 })
    expect(partialFunctionName('="su', 4)).toBeUndefined()
    expect(partialFunctionName('=A1', 3)).toBeUndefined()
    expect(completions('su', docs).map((doc) => doc.name)).toEqual(['SUM', 'SUMIF'])
    expect(applyCompletion('=1+su', 5, 3, 'SUM')).toEqual({ text: '=1+SUM(', caret: 7 })
    expect(activeCall('=VLOOKUP(A1, B:C, ', 18)).toEqual({ name: 'VLOOKUP', argument: 2 })
    expect(activeCall('=SUM(IF(A1,"a,b",2), ', 21)).toEqual({ name: 'SUM', argument: 1 })
    const hint = argumentHint('=VLOOKUP(A1, ', 13, docs)!
    expect(hint.parts.filter((part) => part.active).map((part) => part.text)).toEqual(['table_array'])
    expect(argumentHint('=SUM(1,2,3,', 11, docs)!.parts.filter((part) => part.active).map((part) => part.text)).toEqual(['[number2]'])
  })

  it('inserts and replaces pointed references', () => {
    expect(canInsertReference('=SUM(', 5)).toBe(true)
    expect(canInsertReference('=A1', 3)).toBe(false)
    const first = insertReference('=SUM(', 5, { top: 0, left: 0, bottom: 0, right: 0 }, undefined)
    expect(first.text).toBe('=SUM(A1')
    const second = insertReference(first.text, first.caret, { top: 0, left: 0, bottom: 2, right: 1 }, 'Data!', first.inserted)
    expect(second.text).toBe('=SUM(Data!A1:B3')
  })
})

describe('conditional formats', () => {
  it('evaluates cell rules, top/bottom, duplicates, scales, bars, and icons', () => {
    const target = sheet()
    put(target, [[10], [20], [30], [40], [20]])
    const range = target.rangeIds({ top: 0, left: 0, bottom: 4, right: 0 })
    const add = (format: Omit<ConditionalFormat, 'ranges'>) => target.cf.set(String(target.cf.size), { ranges: [range], ...format })
    add({ rules: [{ type: 'cellIs', operator: 'greaterThan', formulas: ['25'], dxfId: 0, priority: 1 }] })
    add({ rules: [{ type: 'duplicateValues', dxfId: 0, priority: 2 }] })
    add({ rules: [{ type: 'colorScale', priority: 3, colorScale: { values: [{ type: 'min' }, { type: 'max' }], colors: [{ rgb: 'FFFFFFFF' }, { rgb: 'FF000000' }] } }] })
    add({ rules: [{ type: 'dataBar', priority: 4, dataBar: { values: [{ type: 'min' }, { type: 'max' }], color: { rgb: 'FF638EC6' } } }] })
    add({ rules: [{ type: 'iconSet', priority: 5, iconSet: { set: '3Arrows', values: [{ type: 'percent', value: '0' }, { type: 'percent', value: '33' }, { type: 'percent', value: '67' }] } }] })
    const styles = new Stylesheet('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/></font></fonts><cellXfs count="1"><xf/></cellXfs><dxfs count="1"><dxf><font><b/></font></dxf></dxfs></styleSheet>')
    const formatter = new ConditionalFormatter(target, new CachedValues(target.workbook), styles, DEFAULT_THEME_COLORS)
    expect(formatter.overlay(0, 0)!.style).toBeUndefined()
    expect(formatter.overlay(2, 0)!.style!.font!.bold).toBe(true)
    expect(formatter.overlay(1, 0)!.style!.font!.bold).toBe(true)
    expect(formatter.overlay(0, 0)!.scaleColor).toBe('#FFFFFF')
    expect(formatter.overlay(3, 0)!.scaleColor).toBe('#000000')
    expect(formatter.overlay(0, 0)!.dataBar!.fraction).toBeCloseTo(0.1)
    expect(formatter.overlay(3, 0)!.dataBar!.fraction).toBeCloseTo(0.9)
    expect([0, 1, 2, 3].map((row) => formatter.overlay(row, 0)!.icon!.index)).toEqual([0, 1, 1, 2])
  })
})

describe('colors and layout', () => {
  it('applies Excel tints and theme indexes', () => {
    expect(cssColor({ theme: 4, tint: 0.3999755851924192 }, DEFAULT_THEME_COLORS)).toBe('#8EA9DB')
    expect(cssColor({ theme: 1 }, DEFAULT_THEME_COLORS)).toBe('#000000')
    expect(cssColor({ indexed: 10 }, DEFAULT_THEME_COLORS)).toBe('#FF0000')
    expect(cssColor({ rgb: '00FF8800' }, DEFAULT_THEME_COLORS)).toBe('#FF8800')
    expect(cssColor({ auto: true }, DEFAULT_THEME_COLORS)).toBeUndefined()
    // Excel's "Blue, Accent 1, Darker 25%" swatch; tints land within one unit per channel.
    const close = (a: string, b: string) => [0, 2, 4].every((index) => Math.abs(parseInt(a.slice(index, index + 2), 16) - parseInt(b.slice(index, index + 2), 16)) <= 1)
    expect(close(applyTint('4472C4', -0.25), '2F5597')).toBe(true)
  })

  it('converts column widths like Excel', () => {
    expect(columnWidthToPixels(9.140625, 7)).toBe(64)
    expect(columnWidthToPixels(20, 7)).toBe(140)
    expect(pixelsToColumnWidth(64, 7)).toBe(9.140625)
  })

  it('finds rows by offset with hidden and resized rows', () => {
    const layout = new AxisLayout(20, new Map([[1, 0], [3, 50]]), 1000)
    expect(layout.offset(2)).toBe(20)
    expect(layout.offset(4)).toBe(90)
    expect(layout.indexAt(25)).toBe(2)
    expect(layout.indexAt(20)).toBe(2)
    expect(layout.step(0, 1)).toBe(2)
    expect(layout.total).toBe(20 * 998 + 50)
  })
})

const fullSelections: [string, CellRange][] = [
  ['column', { top: 0, left: 0, bottom: MAX_ROWS - 1, right: 0 }],
  ['row', { top: 0, left: 0, bottom: 0, right: MAX_COLS - 1 }],
  ['sheet', { top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }],
]

describe.each(fullSelections)('selection safety: whole %s', (_kind, range) => {
  it('preflights Ctrl+Enter and merge before any write', () => {
    for (const command of [
      (target: SheetModel) => commands.fillInput(target, [range], { row: 0, col: 0 }, 'new'),
      (target: SheetModel) => commands.mergeRanges(target, [range]),
      (target: SheetModel) => commands.mergeRanges(target, [range], 'across'),
    ]) {
      const target = sheet()
      target.setCell(0, 0, { v: 'keep' })
      const before = Y.encodeStateAsUpdate(target.workbook.doc)
      if (commands.canExpandRanges([range])) command(target)
      else { expect(() => command(target)).toThrow(commands.DataOperationError); expect(Y.encodeStateAsUpdate(target.workbook.doc)).toEqual(before) }
    }
  })

  it('styles blank tails and clears only formats, without expanding cells', () => {
    const target = sheet()
    target.setCell(0, 0, { v: 1 })
    target.setRowProp([0], 'size', 27)
    target.setColProp([0], 'hidden', true)
    commands.applyStyle(target, [range], { bold: true, numFmt: '0.00%' })
    const axis = _kind === 'row' ? 'row' : 'col'
    const id = axis === 'row' ? target.rows.idAt(0) : target.cols.idAt(_kind === 'sheet' ? MAX_COLS - 1 : 0)
    expect(target.axisOverrides(axis, id)).toEqual({ bold: true, numFmt: '0.00%' })
    expect(target.cells.size).toBe(1)
    expect(target.fmt.size).toBe(2)
    commands.clearFormats(target, [range])
    expect(target.axisOverrides(axis, id)).toEqual({})
    expect(target.fmt.size).toBe(0)
    expect(target.cell(0, 0)?.v).toBe(1)
    expect(target.rowProp(0, 'size')).toBe(27)
    expect(target.colProp(0, 'hidden')).toBe(true)
    commands.fillInput(target, [range], { row: 0, col: 0 }, '')
    expect(target.cells.size).toBe(0)
  })

  it.each(['all', 'none', 'outer'] as const)('bounds borders: %s', (preset) => {
    const target = sheet()
    const before = Y.encodeStateAsUpdate(target.workbook.doc)
    if (preset === 'outer' && !commands.canExpandRanges([range])) {
      expect(() => commands.applyBorders(target, [range], preset)).toThrow(commands.DataOperationError)
      expect(Y.encodeStateAsUpdate(target.workbook.doc)).toEqual(before)
    } else {
      commands.applyBorders(target, [range], preset)
      expect(target.cells.size).toBe(0)
      if (preset !== 'outer') expect(target.fmt.size).toBe(0)
    }
  })

  it('clears stored contents, unmerges, filters and applies validation sparsely', () => {
    const target = sheet()
    target.setCell(0, 0, { v: 'selected' })
    target.setCell(2, 2, { v: 'outside' })
    commands.clearContents(target, [range])
    expect(target.cell(0, 0)).toBeUndefined()
    expect(target.cell(2, 2)?.v).toBe(_kind === 'sheet' ? undefined : 'outside')
    commands.setValidation(target, [range], { type: 'whole' })
    expect(commands.validationAt(target, 0, 0)?.type).toBe('whole')
    commands.setAutoFilter(target, range)
    commands.setAutoFilter(target, undefined)
    target.merges.set('test', { range: target.rangeIds({ top: 0, left: 0, bottom: 1, right: 1 }) })
    commands.unmergeRanges(target, [range])
    expect(target.merges.size).toBe(0)
  })
})

it('checks all dense ranges before applying the first one', () => {
  const target = sheet()
  const ranges = [{ top: 0, left: 0, bottom: 0, right: 0 }, { top: 1, left: 1, bottom: MAX_ROWS - 2, right: 10 }]
  const before = Y.encodeStateAsUpdate(target.workbook.doc)
  for (const command of [
    () => commands.fillInput(target, ranges, { row: 0, col: 0 }, 'x'),
    () => commands.applyStyle(target, ranges, { bold: true }),
    () => commands.applyBorders(target, ranges, 'outer'),
    () => commands.mergeRanges(target, ranges),
  ]) { expect(command).toThrow(commands.DataOperationError); expect(Y.encodeStateAsUpdate(target.workbook.doc)).toEqual(before) }
})

it('clears imported column intervals without changing adjacent formats or widths', () => {
  const target = sheet()
  target.raw.set('colTail', [{ from: 0, to: MAX_COLS - 1, props: { xf: 5, size: 19, hidden: true } }])
  target.setColProp([0], 'xf', 6)
  target.setRowProp([0], 'xf', 7)
  commands.clearFormats(target, [{ top: 0, bottom: MAX_ROWS - 1, left: 0, right: 0 }])
  expect(target.colProp(0, 'xf')).toBeUndefined()
  expect(target.rowProp(0, 'xf')).toBe(7)
  expect(target.raw.get('colTail')).toEqual([
    { from: 0, to: 0, props: { size: 19, hidden: true } },
    { from: 1, to: MAX_COLS - 1, props: { xf: 5, size: 19, hidden: true } },
  ])
})

it('clears both legacy and positional row styles after sorting, preserving row geometry', () => {
  const target = sheet()
  put(target, [[2], [1]])
  target.setRowProp([0], 'xf', 4)
  target.rowMeta.set(`${target.rows.idAt(0)}|s.bold`, true)
  target.setRowProp([0], 'size', 30)
  commands.sortRange(target, { top: 0, left: 0, bottom: 1, right: 0 }, [{ col: 0 }], (row) => target.cell(row, 0)?.v ?? null)
  commands.applyStyle(target, [fullSelections[1]![1]], { italic: true })
  commands.clearFormats(target, [fullSelections[1]![1]])
  expect(target.rowProp(0, 'xf')).toBeUndefined()
  expect(target.axisOverrides('row', target.rows.idAt(0))).toEqual({})
  expect(target.rowProp(0, 'size')).toBe(30)
})
