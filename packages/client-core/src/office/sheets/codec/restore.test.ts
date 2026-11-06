import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { trackEdits } from '../model/edits.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetCodec } from './codec.js'

const savedTime = Date.UTC(2024, 0, 1, 1)
const editedTime = Date.UTC(2025, 1, 2, 2)

describe('spreadsheet snapshot restoration', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it.each([undefined, savedTime, editedTime + 60_001])('restores saved formula caches and clock %s with an editor tracking edits', async (time) => {
    vi.spyOn(Date, 'now').mockReturnValue(editedTime)
    const codec = new SheetCodec()
    const context = { name: 'Clock.xlsx', assets: new MemoryLiveAssetStore() }
    const source = new Y.Doc()
    const doc = new Y.Doc()
    let stop = () => {}
    try {
      await codec.createEmpty(source, context)
      const sourceModel = new WorkbookModel(source)
      if (time !== undefined) sourceModel.setMeta('calcTime', time)
      const sheet = sourceModel.sheets()[0]!
      sheet.setCell(0, 0, { v: 'before' })
      // Values deliberately differ from a fresh calculation: these are the saved snapshot.
      sheet.setCell(1, 0, { f: 'NOW()', v: 123 })
      sheet.setCell(2, 0, { f: 'TODAY()', v: 456 })
      sheet.setCell(3, 0, { f: 'RAND()', v: 0.75 })
      await codec.importFile(doc, await codec.exportFile(source, context), context)
      const before = await codec.exportFile(doc, context)
      const model = new WorkbookModel(doc)
      const sheetId = model.sheets()[0]!.id
      const rowId = model.sheets()[0]!.rows.idAt(0)
      stop = trackEdits(doc)
      const parts = unzipSync(before)
      parts['xl/sharedStrings.xml'] = strToU8(strFromU8(parts['xl/sharedStrings.xml']!).replace('before', 'after'))
      expect(await codec.applyFile(doc, zipSync(parts), context, 'agent')).toEqual({ changed: true })
      expect(model.metaValue('calcDirty')).toBe(true)
      expect(model.metaValue('calcTime')).toBe(editedTime)
      expect(model.metaValue('calcTimezoneOffset')).toBe(new Date(editedTime).getTimezoneOffset())
      const after = await codec.exportFile(doc, context)
      expect(Buffer.from(after)).not.toEqual(Buffer.from(before))

      for (const snapshot of [before, after, before, after]) {
        expect(await codec.applyFile(doc, snapshot, context, 'restore')).toEqual({ changed: true })
        expect(model.metaValue('calcDirty')).toBeUndefined()
        expect(model.metaValue('calcTimezoneOffset')).toBeUndefined()
        const out = await codec.exportFile(doc, context)
        expect(Buffer.from(out)).toEqual(Buffer.from(snapshot))
        expect(model.sheets()[0]!.id).toBe(sheetId)
        expect(model.sheets()[0]!.rows.idAt(0)).toBe(rowId)
        expect(await codec.applyFile(doc, snapshot, context, 'restore')).toEqual({ changed: false })
      }
    } finally {
      stop()
      source.destroy()
      doc.destroy()
    }
  })

  it('restores a clock-only change even when all formula text is unchanged', async () => {
    const codec = new SheetCodec()
    const doc = new Y.Doc()
    const context = { name: 'Clock.xlsx', assets: new MemoryLiveAssetStore() }
    try {
      await codec.createEmpty(doc, context)
      const model = new WorkbookModel(doc)
      model.setMeta('calcTime', savedTime)
      const before = await codec.exportFile(doc, context)
      model.setMeta('calcTime', editedTime)
      expect(await codec.applyFile(doc, before, context, 'restore')).toEqual({ changed: true })
      expect(model.metaValue('calcTime')).toBe(savedTime)
      expect(Buffer.from(await codec.exportFile(doc, context))).toEqual(Buffer.from(before))
    } finally {
      doc.destroy()
    }
  })
})
