import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { SheetCalc } from './calc.js'
import { SheetCodec } from './codec/codec.js'
import { epochMsToSerial } from './dates.js'
import { toIdForm } from './model/formula-ids.js'
import { IMPORT_ORIGIN, trackEdits } from './model/edits.js'
import type { ConditionalFormat, DataValidation, DrawingObject, SheetTable } from './model/schema.js'
import { WorkbookModel, type SheetModel } from './model/workbook.js'

function setInput(sheet: SheetModel, row: number, col: number, value: string) {
  sheet.setCell(row, col, value.startsWith('=') ? { f: toIdForm(value.slice(1), sheet), dynamic: true } : { v: value === '1' || value === '9' ? Number(value) : value })
}

const codec = new SheetCodec()
const context = () => ({ name: 'Book.xlsx', assets: new MemoryLiveAssetStore() })

function workbook() {
  const doc = new Y.Doc()
  const model = WorkbookModel.initialize(doc)
  const sheet = model.addSheet('Sheet1')
  return { doc, model, sheet }
}

async function imported(bytes: Uint8Array, ctx = context()) {
  const doc = new Y.Doc()
  await codec.importFile(doc, bytes, ctx)
  const model = new WorkbookModel(doc)
  return { doc, model, sheet: model.sheets()[0]!, ctx }
}

function patch(bytes: Uint8Array, path: string, change: (xml: string) => string) {
  const parts = unzipSync(bytes)
  parts[path] = strToU8(change(strFromU8(parts[path]!)))
  return zipSync(parts)
}

describe('calculation audit regressions', () => {
  it.each([
    'SUM(SEQUENCE(1048576,16384))', 'SUM(SEQUENCE(2000000))',
    'MAKEARRAY(1048576,16384,LAMBDA(r,c,1))', 'RANDARRAY(1048576,16384)',
    'MUNIT(1001)', 'CHOOSECOLS(SEQUENCE(1000,600),SEQUENCE(1,1001,1,0))', 'EXPAND(1,1001,1000)', 'SEQUENCE(1001)+SEQUENCE(1,1000)',
    'ABS(SEQUENCE(1001)+SEQUENCE(1,1000))', 'IF(SEQUENCE(1001),SEQUENCE(1,1000),0)',
    'HSTACK(SEQUENCE(1000,600),SEQUENCE(1000,600))',
    'VSTACK(SEQUENCE(600,1000),SEQUENCE(600,1000))',
    'TEXTSPLIT(REPT("x,",1000)&REPT(";",1000),",",";")',
    'MMULT(SEQUENCE(1001),SEQUENCE(1,1000))',
  ])('rejects oversized intermediate arrays before allocation: %s (finding 1)', (formula) => {
    const { model, sheet } = workbook()
    const calc = new SheetCalc(model)
    expect(calc.evaluate(sheet, 0, 0, formula)).toEqual({ e: '#NUM!' })
    expect(calc.evaluate(sheet, 0, 0, 'SEQUENCE(2,3)')).toEqual([[1, 2, 3], [4, 5, 6]])
    calc.destroy()
  })

  it('bounds range materialization and text expansion (finding 1)', () => {
    const { model, sheet } = workbook()
    sheet.setCell(1000, 999, { v: 1 })
    const calc = new SheetCalc(model)
    expect(calc.evaluate(sheet, 0, 0, 'SUM(A1:ALL1001)')).toEqual({ e: '#NUM!' })
    expect(calc.evaluate(sheet, 0, 0, 'CONCAT(REPT("x",32767),"x")')).toEqual({ e: '#VALUE!' })
    expect(calc.evaluate(sheet, 0, 0, 'REPT("x",32768)')).toEqual({ e: '#VALUE!' })
    expect(calc.evaluate(sheet, 0, 0, 'SUBSTITUTE(REPT("x",32767),"x",REPT("y",32767))')).toEqual({ e: '#VALUE!' })
    calc.destroy()
  })

  it('stops total work while pending formulas retain their caches (finding 1)', () => {
    const { model, sheet } = workbook()
    sheet.setCell(0, 0, { f: '2+3', v: 1 })
    sheet.setCell(1, 0, { f: 'SUM(SEQUENCE(100))', v: 77 })
    sheet.setCell(2, 0, { f: '2+3', v: 88 })
    model.setMeta('calcDirty', true)
    const calc = new SheetCalc(model, { maxWork: 40 })
    expect(calc.stoppedEarly).toBe(true)
    expect(calc.get(sheet, 1, 0)).toBe(77)
    expect(calc.get(sheet, 2, 0)).toBe(88)
    calc.destroy()
  })

  it.each([20000, 4294967295])('caps imported iterateCount=%s at 1000 (finding 2)', async (count) => {
    const { doc, sheet } = workbook()
    setInput(sheet, 0, 0, '=A1+1')
    const ctx = context()
    const bytes = patch(await codec.exportFile(doc, ctx), 'xl/workbook.xml', (xml) => xml.replace(/<calcPr[^>]*\/>/, `<calcPr iterate="1" iterateCount="${count}" iterateDelta="0.001"/>`))
    const loaded = await imported(bytes, ctx)
    const calc = new SheetCalc(loaded.model)
    calc.recalculateAll()
    const bounded = new SheetCalc(loaded.model, { maxWork: 40 })
    bounded.recalculateAll()
    expect(bounded.stoppedEarly).toBe(true)
    expect(bounded.get(loaded.sheet, 0, 0)).toBeLessThan(1000)
    bounded.destroy()
    expect(loaded.model.metaValue('iterateCount')).toBe(count)
    expect(calc.get(loaded.sheet, 0, 0)).toBe(1000)
    expect(calc.get(loaded.sheet, 0, 0)).toBeGreaterThan(0)
    calc.destroy()
  })

  it('refreshes stale caches in fresh calculators, text and exports (finding 3)', async () => {
    const { doc, sheet } = workbook()
    setInput(sheet, 0, 0, '1')
    setInput(sheet, 0, 1, '=A1*2')
    const ctx = context()
    const loaded = await imported(await codec.exportFile(doc, ctx), ctx)
    expect(loaded.sheet.cell(0, 1)?.v).toBe(2)
    const stop = trackEdits(loaded.doc)
    setInput(loaded.sheet, 0, 0, '9')
    expect(loaded.model.metaValue('calcDirty')).toBe(true)
    const calc = new SheetCalc(loaded.model)
    expect(calc.get(loaded.sheet, 0, 1)).toBe(18)
    expect(codec.toText(loaded.doc)).toContain('9\t18')
    const again = await imported(await codec.exportFile(loaded.doc, ctx), ctx)
    expect(again.sheet.cell(0, 1)?.v).toBe(18)
    stop()
    calc.destroy()
  })

  it('keeps unknown-function, external-reference and data-table caches under full recalc (finding 3)', () => {
    const { model, sheet } = workbook()
    sheet.setCell(0, 0, { f: 'UNKNOWNFUNCTION(1)', v: 42 })
    sheet.setCell(1, 0, { f: '[other.xlsx]Sheet1!A1', v: 43 })
    sheet.setCell(2, 0, { f: '1+1', v: 44, keep: { fText: 'TABLE(A1)', f: { t: 'dataTable' } } })
    sheet.setCell(3, 0, { f: '1+1', v: 99 })
    const cached = new SheetCalc(model, { live: false })
    expect(cached.get(sheet, 3, 0)).toBe(99)
    cached.destroy()
    model.setMeta('calcDirty', true)
    const calc = new SheetCalc(model)
    expect(calc.get(sheet, 3, 0)).toBe(2)
    expect([0, 1, 2].map((row) => calc.get(sheet, row, 0))).toEqual([42, 43, 44])
    calc.destroy()
  })

  it('tracks only local workbook edits, throttles the clock and unsubscribes (finding 3)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      const { doc, model, sheet } = workbook()
      const stop = trackEdits(doc)
      doc.getMap('unrelated').set('x', 1)
      expect(model.metaValue('calcDirty')).toBeUndefined()
      doc.transact(() => sheet.setCell(0, 0, { v: 1 }), IMPORT_ORIGIN)
      expect(model.metaValue('calcDirty')).toBeUndefined()
      sheet.setCell(0, 0, { v: 2 })
      const time = model.metaValue('calcTime')
      vi.advanceTimersByTime(60_000)
      sheet.setCell(0, 0, { v: 3 })
      expect(model.metaValue('calcTime')).toBe(time)
      vi.advanceTimersByTime(1)
      sheet.setCell(0, 0, { v: 4 })
      expect(model.metaValue('calcTime')).toBe(time! + 60_001)
      const other = new Y.Doc()
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
      new WorkbookModel(other).sheets()[0]!.setCell(0, 0, { v: 5 })
      vi.advanceTimersByTime(60_001)
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other))
      expect(model.metaValue('calcTime')).toBe(time! + 60_001)
      stop()
      sheet.setCell(0, 0, { v: 6 })
      expect(model.metaValue('calcTime')).toBe(time! + 60_001)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks changed applyFile calls and ignores calculation metadata in comparisons (finding 3)', async () => {
    const ctx = context()
    const { doc, sheet } = workbook()
    setInput(sheet, 0, 0, '1')
    const loaded = await imported(await codec.exportFile(doc, ctx), ctx)
    setInput(sheet, 0, 0, '9')
    expect(await codec.applyFile(loaded.doc, await codec.exportFile(doc, ctx), ctx)).toEqual({ changed: true })
    expect(loaded.model.metaValue('calcDirty')).toBe(true)
    const bytes = await codec.exportFile(loaded.doc, ctx)
    expect(await codec.applyFile(loaded.doc, bytes, ctx)).toEqual({ changed: false })
  })

  it.each([false, true])('uses the workbook epoch for ISO dates, date1904=%s (finding 4)', async (date1904) => {
    const ctx = context()
    const { doc, model, sheet } = workbook()
    model.setMeta('date1904', date1904)
    sheet.setCell(0, 0, { v: 1 })
    sheet.setStyle({ top: 0, left: 0, bottom: 0, right: 0 }, { numFmt: 'yyyy-mm-dd' })
    const bytes = patch(await codec.exportFile(doc, ctx), 'xl/worksheets/sheet1.xml', (xml) => xml.replace(/<c r="A1"[^>]*>.*?<\/c>/, '<c r="A1" s="1" t="d"><v>2024-01-01T00:00:00</v></c>'))
    const loaded = await imported(bytes, ctx)
    expect(loaded.sheet.cell(0, 0)?.v).toBe(epochMsToSerial(Date.UTC(2024, 0, 1), date1904))
    expect(codec.toText(loaded.doc)).toContain('2024-01-01')
    const output = await codec.exportFile(loaded.doc, ctx)
    const python = join(homedir(), '.cache/pulpo-sheets-venv/bin/python')
    if (existsSync(python)) {
      const dir = mkdtempSync(join(tmpdir(), 'sheets-date-'))
      try {
        writeFileSync(join(dir, 'after.xlsx'), output)
        expect(execFileSync(python, ['-I', '-c', 'import openpyxl,sys; print(openpyxl.load_workbook(sys.argv[1]).active["A1"].value.isoformat())', join(dir, 'after.xlsx')], { encoding: 'utf8' }).trim()).toBe('2024-01-01T00:00:00')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it.each([false, true])('exports volatile snapshots reproducibly across time and fresh imports, tracked=%s (finding 7)', async (tracked) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
      const { doc, sheet } = workbook()
      const stop = tracked ? trackEdits(doc) : () => {}
      for (const [col, formula] of ['RAND()', 'NOW()', 'TODAY()', 'RAND()'].entries()) setInput(sheet, 0, col, `=${formula}`)
      const ctx = context()
      const before = await codec.exportFile(doc, ctx)
      const text = codec.toText(doc)
      vi.setSystemTime(new Date('2025-03-04T15:00:00Z'))
      expect(await codec.exportFile(doc, ctx)).toEqual(before)
      expect(codec.toText(doc)).toBe(text)
      const loaded = await imported(before, ctx)
      expect(loaded.model.metaValue('calcDirty')).not.toBe(true)
      const after = await codec.exportFile(loaded.doc, ctx)
      const a = unzipSync(before)
      const b = unzipSync(after)
      for (const path of Object.keys(a)) expect(strFromU8(b[path]!), path).toBe(strFromU8(a[path]!))
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([[1, 2, false], [1, 2, true], [2, 1, false], [2, 1, true]] as const)('exports converged replicas canonically, IDs %s/%s, reverse=%s (finding 8)', async (leftId, rightId, reverse) => {
    const { doc } = workbook()
    doc.clientID = 100
    const left = new Y.Doc()
    const right = new Y.Doc()
    Y.applyUpdate(left, Y.encodeStateAsUpdate(doc))
    Y.applyUpdate(right, Y.encodeStateAsUpdate(doc))
    left.clientID = leftId
    right.clientID = rightId
    for (const [replica, col, value] of [[left, 0, 'alpha'], [right, 1, 'beta']] as const) {
      const sheet = new WorkbookModel(replica).sheets()[0]!
      setInput(sheet, 0, col, value)
      sheet.setStyle({ top: 0, left: col, bottom: 0, right: col }, { bold: col === 0, italic: col === 1 })
      const key = sheet.keyAt(0, col)
      const range = sheet.rangeIds({ top: 0, left: col, bottom: 0, right: col })
      sheet.notes.set(key, { author: value, text: value })
      sheet.links.set(key, { target: `https://example.com/${value}` })
      sheet.merges.set(value, { range: sheet.rangeIds({ top: 3, left: col * 2, bottom: 3, right: col * 2 + 1 }) })
      sheet.cf.set(value, { ranges: [range], rules: [{ type: 'expression', priority: col + 1, formulas: ['1'] }] } satisfies ConditionalFormat)
      sheet.dv.set(value, { ranges: [range], type: 'whole', formula1: '1' } satisfies DataValidation)
      sheet.tables.set(value, { name: value, displayName: value, range, headerRow: true, totalsRow: false, columns: [{ name: value }] } satisfies SheetTable)
      sheet.drawings.set(value, { kind: 'shape', anchor: 'oneCell', from: { row: range.top!, col: range.left!, rowOff: 0, colOff: 0 }, ext: { cx: 100, cy: 100 }, z: 1, xml: `<xdr:sp><xdr:cNvPr id="${col + 1}" name="${value}"/></xdr:sp>` } satisfies DrawingObject)
    }
    const a = Y.encodeStateAsUpdate(left)
    const b = Y.encodeStateAsUpdate(right)
    if (reverse) { Y.applyUpdate(right, a); Y.applyUpdate(left, b) }
    else { Y.applyUpdate(left, b); Y.applyUpdate(right, a) }
    const ctx = context()
    const bytes = await codec.exportFile(left, ctx)
    expect(await codec.exportFile(right, ctx)).toEqual(bytes)
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, Y.encodeStateAsUpdate(left))
    expect(await codec.exportFile(rebuilt, ctx)).toEqual(bytes)
  })
})
