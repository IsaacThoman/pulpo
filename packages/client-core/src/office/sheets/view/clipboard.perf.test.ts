import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { WorkbookModel } from '../model/workbook.js'
import { SheetInteractions } from './interactions.js'
import type { SheetView } from './sheet-view.js'

// Exercise the synchronous copy handler without canvas/DOM overhead. Values here are the
// calculated SEQUENCE results; formula calculation is outside the handler's measured work.
function copySequence(count: number, individualSpills = false) {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  sheet.setCell(0, 0, { f: `SEQUENCE(${count})`, dynamic: true })
  if (individualSpills) doc.transact(() => {
    for (let row = 0; row < count; row++) sheet.setCell(row, 0, { f: 'SEQUENCE(1)', dynamic: true })
  })
  const range = { top: 0, left: 0, bottom: count - 1, right: 0 }
  let renders = 0, scanned = 0
  const view = {
    sheet, selection: { ranges: [range] }, rows: { isHidden: () => false },
    values: { spill: () => ({ rows: individualSpills ? 1 : count, cols: 1 }) },
    cellRender: (row: number) => { renders++; return { text: String(row + 1), value: row + 1, style: {} } },
    styleAt: () => ({}), stylesheetFor: { toXml: () => '' },
  } as unknown as SheetView
  const handler = Object.create(SheetInteractions.prototype) as SheetInteractions
  Object.assign(handler, { view })
  const includes = Array.prototype.includes, indexOf = Array.prototype.indexOf
  // Count the potential comparisons of linear axis searches. The previous 200k spill copy
  // spent 20 billion comparisons here; this assertion is independent of runner speed.
  const inc = vi.spyOn(Array.prototype, 'includes').mockImplementation(function (this: unknown[], value, from) {
    scanned += this.length
    return includes.call(this, value, from)
  })
  const idx = vi.spyOn(Array.prototype, 'indexOf').mockImplementation(function (this: unknown[], value, from) {
    scanned += this.length
    return indexOf.call(this, value, from)
  })
  const start = performance.now()
  try {
    const payload = handler.copyPayload()!
    const ms = performance.now() - start
    expect(payload.internal!.cells).toHaveLength(count)
    expect(payload.internal!.cells[count - 1]![0]!.data).toEqual(individualSpills ? sheet.cell(count - 1, 0) : undefined)
    expect(payload.internal!.values[count - 1]).toEqual([count])
    expect(renders).toBe(count)
    expect(scanned).toBeLessThan(count * 32)
    return ms
  } finally { inc.mockRestore(); idx.mockRestore(); doc.destroy() }
}

it('copies a 200k-row spill with linear membership work and near-linear scaling', () => {
  copySequence(1000) // warm transforms and caches
  const small = copySequence(100_000), large = copySequence(200_000)
  console.info(`[perf] copy SEQUENCE: 100k=${small.toFixed(0)}ms, 200k=${large.toFixed(0)}ms`)
  expect(large).toBeLessThan(5000)
  expect(large).toBeLessThan(Math.max(1000, small * 3.5))
}, 30_000)

it('visits only each spill overlap when copying many independent arrays', () => {
  const small = copySequence(5000, true), large = copySequence(10_000, true)
  expect(large).toBeLessThan(Math.max(1000, small * 3.5))
}, 30_000)
