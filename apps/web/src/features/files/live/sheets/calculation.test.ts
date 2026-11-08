import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { WorkbookModel } from '@pulpo/client-core/office/sheets'
import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { exportSheetAsText, exportSheetFile, registerSheetEditor } from './calculation'

it('exports the sheet in view as CSV or TSV without touching the shared workbook', async () => {
  const doc = new Y.Doc()
  const peer = new Y.Doc()
  // A collaborator receives every update the export might make to the shared document.
  doc.on('update', (update: Uint8Array) => Y.applyUpdate(peer, update))
  const book = WorkbookModel.initialize(doc)
  book.addSheet('First').setCell(0, 0, { v: 'first sheet' })
  const second = book.addSheet('Second')
  second.setCell(0, 0, { v: 'a' })
  second.setCell(0, 1, { v: 2 })
  const before = Y.encodeStateVector(peer)
  const settleEdit = vi.fn(() => { second.setCell(1, 0, { v: 'typed' }); return true })
  const unregister = registerSheetEditor(doc, { settleEdit })
  const csv = await exportSheetAsText(doc, second.id, 'Book - Second.csv', new MemoryLiveAssetStore())
  expect(new TextDecoder().decode(csv)).toBe('a,2\r\ntyped,\r\n')
  const tsv = await exportSheetAsText(doc, second.id, 'Book - Second.tsv', new MemoryLiveAssetStore())
  expect(new TextDecoder().decode(tsv)).toBe('a\t2\r\ntyped\t\r\n')
  unregister()
  // Only the settled edit reached the collaborator; the recorded active sheet did not change.
  expect(book.metaValue('activeSheet')).toBeUndefined()
  expect(new WorkbookModel(peer).metaValue('activeSheet')).toBeUndefined()
  expect(new WorkbookModel(peer).sheet(second.id)?.cell(1, 0)?.v).toBe('typed')
  expect(Y.encodeStateVector(peer)).not.toEqual(before)
  expect(new TextDecoder().decode(await exportSheetFile(doc, 'Book.csv', new MemoryLiveAssetStore()))).toBe('first sheet\r\n')
})

it('settles the registered view before exporting a live document', async () => {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc, { format: 'csv' })
  const sheet = book.addSheet('Sheet1')
  const settleEdit = vi.fn(() => { sheet.setCell(0, 0, { v: 'pending edit' }); return true })
  const unregister = registerSheetEditor(doc, { settleEdit })
  const bytes = await exportSheetFile(doc, 'Book.csv', new MemoryLiveAssetStore())
  expect(new TextDecoder().decode(bytes)).toBe('pending edit\r\n')
  expect(settleEdit).toHaveBeenCalledOnce()
  unregister()
  await exportSheetFile(doc, 'Book.csv', new MemoryLiveAssetStore())
  expect(settleEdit).toHaveBeenCalledOnce()
})

it('keeps a newer registration when the previous editor unmounts', async () => {
  const doc = new Y.Doc()
  WorkbookModel.initialize(doc).addSheet('Sheet1')
  const old = registerSheetEditor(doc, { settleEdit: () => true })
  const settleEdit = vi.fn(() => false)
  registerSheetEditor(doc, { settleEdit })
  old()
  await exportSheetFile(doc, 'Book.csv', new MemoryLiveAssetStore())
  expect(settleEdit).toHaveBeenCalledOnce()
})
