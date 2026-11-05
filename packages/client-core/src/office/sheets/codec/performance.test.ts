import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryAssetStore } from '../../memory-assets.js'
import { toIdForm } from '../model/formula-ids.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetCodec } from './codec.js'

/**
 * Loose budgets for big workbooks: generous enough for slow CI machines, tight enough to catch
 * a quadratic slip (the first version took minutes on a sheet with many merges).
 */
describe('performance', () => {
  it('imports, exports, and re-applies a 100,000-row workbook within budget', async () => {
    const codec = new SheetCodec()
    const assets = new MemoryAssetStore()
    const source = new Y.Doc()
    const model = WorkbookModel.initialize(source)
    const sheet = model.addSheet('Big')
    source.transact(() => {
      sheet.rows.ensure(100_001)
      sheet.cols.ensure(10)
      for (let row = 0; row < 100_000; row++) {
        for (let col = 0; col < 8; col++) sheet.cells.set(sheet.keyAt(row, col), { v: col === 0 ? `Item ${row}` : row * col })
        sheet.cells.set(sheet.keyAt(row, 8), { f: toIdForm(`SUM(B${row + 1}:H${row + 1})`, sheet), v: 0 })
      }
      for (let row = 0; row < 2_000; row++) sheet.merges.set(`m${row}`, { range: sheet.rangeIds({ top: row * 50, left: 9, bottom: row * 50 + 1, right: 9 }) })
    })
    let started = performance.now()
    const bytes = await codec.exportFile(source, { name: 'Big.xlsx', assets })
    const exportMs = performance.now() - started

    globalThis.gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    const doc = new Y.Doc()
    started = performance.now()
    await codec.importFile(doc, bytes, { name: 'Big.xlsx', assets })
    const importMs = performance.now() - started
    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1e6

    started = performance.now()
    const result = await codec.applyFile(doc, bytes, { name: 'Big.xlsx', assets })
    const applyMs = performance.now() - started

    started = performance.now()
    const update = Y.encodeStateAsUpdate(doc)
    const encodeMs = performance.now() - started

    console.info(`900k cells: export ${Math.round(exportMs)}ms, import ${Math.round(importMs)}ms (~${Math.round(heapMb)} MB heap), apply unchanged ${Math.round(applyMs)}ms, state ${(update.byteLength / 1e6).toFixed(1)} MB encoded in ${Math.round(encodeMs)}ms; file ${(bytes.byteLength / 1e6).toFixed(1)} MB`)
    expect(result.changed).toBe(false)
    expect(new WorkbookModel(doc).sheets()[0]!.cell(99_999, 0)!.v).toBe('Item 99999')
    expect(exportMs).toBeLessThan(30_000)
    expect(importMs).toBeLessThan(30_000)
    expect(applyMs).toBeLessThan(60_000)
  }, 180_000)
})
