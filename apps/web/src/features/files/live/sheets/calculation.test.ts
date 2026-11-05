import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { WorkbookModel } from '@pulpo/client-core/office/sheets'
import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { exportSheetFile, registerSheetEditor } from './calculation'

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
