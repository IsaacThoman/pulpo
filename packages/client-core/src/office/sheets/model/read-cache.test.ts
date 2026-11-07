import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { WorkbookModel } from './workbook.js'
import { validationAt } from '../view/commands.js'

it('indexes ranged metadata once per read pass and invalidates before observers and inside transactions', () => {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  doc.transact(() => {
    for (let row = 0; row < 1000; row++) {
      const range = sheet.rangeIds({ top: row, bottom: row, left: 0, right: 1 })
      sheet.links.set(`link${row}`, { range, target: `https://example.com/${row}` })
      sheet.dv.set(`rule${row}`, { ranges: [range], type: 'whole', formula1: String(row) })
      sheet.merges.set(`merge${row}`, { range })
    }
  })
  const resolve = vi.spyOn(sheet, 'resolveRange')
  for (let row = 0; row < 1000; row++) {
    expect(sheet.linkAt(row, 1)?.target).toBe(`https://example.com/${row}`)
    expect(validationAt(sheet, row, 1)?.formula1).toBe(String(row))
    expect(sheet.mergedRanges()).toHaveLength(1000)
  }
  expect(resolve.mock.calls.length).toBe(3000)
  const observe = vi.fn(() => expect(sheet.linkAt(0, 1)).toBeUndefined())
  sheet.links.observe(observe)
  sheet.links.delete('link0')
  expect(observe).toHaveBeenCalledOnce()
  sheet.links.unobserve(observe)
  doc.transact(() => {
    sheet.dv.delete('rule0')
    expect(validationAt(sheet, 0, 1)).toBeUndefined()
    sheet.merges.delete('merge0')
    expect(sheet.mergedRanges()).toHaveLength(999)
  })
  const remote = new Y.Doc()
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
  const vector = Y.encodeStateVector(remote)
  new WorkbookModel(remote).sheets()[0]!.links.delete('link1')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, vector))
  expect(sheet.linkAt(1, 1)).toBeUndefined()
  resolve.mockRestore()
  remote.destroy()
  doc.destroy()
})
