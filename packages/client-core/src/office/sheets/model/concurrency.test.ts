import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { SheetCodec } from '../codec/codec.js'
import * as commands from '../view/commands.js'
import { toA1Form, toIdForm } from './formula-ids.js'
import { deleteAxis, insertAxis, moveAxis } from './structure.js'
import { WorkbookModel } from './workbook.js'

/** Deterministic random numbers, so failures reproduce. */
function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function snapshot(model: WorkbookModel): string {
  return JSON.stringify(
    model.sheets().map((sheet) => {
      const cells: Record<string, unknown> = {}
      sheet.forEachCell((row, col, data) => {
        cells[`${row},${col}`] = data.f !== undefined ? `=${toA1Form(data.f, sheet)}` : data.v
      })
      const styles: Record<string, unknown> = {}
      for (const key of sheet.fmt.keys()) {
        const owner = key.slice(0, key.lastIndexOf('|'))
        const position = sheet.position(owner)
        if (position) styles[`${position.row},${position.col}|${key.slice(key.lastIndexOf('|') + 1)}`] = sheet.fmt.get(key)
      }
      const sorted = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
      return { name: sheet.name, cells: sorted(cells), styles: sorted(styles), merges: sheet.mergedRanges().map((merge) => merge.range) }
    }),
  )
}

describe('concurrent editing', () => {
  for (const seed of Array.from({ length: 30 }, (_, index) => index + 1)) {
    it(`converges and exports the same valid file (seed ${seed})`, async () => {
      const random = generator(seed)
      const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!
      const origin = new Y.Doc()
      const base = WorkbookModel.initialize(origin)
      base.addSheet('Sheet1')
      const docs = [0, 1, 2].map(() => {
        const doc = new Y.Doc()
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(origin))
        return doc
      })
      const models = docs.map((doc) => new WorkbookModel(doc))
      const sync = (a: number, b: number) => {
        Y.applyUpdate(docs[b]!, Y.encodeStateAsUpdate(docs[a]!, Y.encodeStateVector(docs[b]!)))
        Y.applyUpdate(docs[a]!, Y.encodeStateAsUpdate(docs[b]!, Y.encodeStateVector(docs[a]!)))
      }
      for (let step = 0; step < 150; step++) {
        const model = pick(models)
        const sheets = model.sheets()
        const sheet = pick(sheets)
        const row = Math.floor(random() * 12)
        const col = Math.floor(random() * 6)
        switch (Math.floor(random() * 12)) {
          case 0:
          case 1:
          case 2:
            sheet.setCell(row, col, { v: Math.round(random() * 100) })
            break
          case 3:
            sheet.setCell(row, col, { f: toIdForm(`SUM(A1:B${1 + Math.floor(random() * 10)})+${pick(sheets).name === sheet.name ? 'C2' : `'${pick(sheets).name}'!A1`}`, sheet) })
            break
          case 4:
            commands.applyStyle(sheet, [{ top: row, left: col, bottom: row + 2, right: col + 1 }], pick([{ bold: true }, { italic: true }, { fill: { rgb: 'FFFFFF00' } }, { numFmt: '0.00' }]))
            break
          case 5:
            insertAxis(sheet, pick(['row', 'col'] as const), row, 1 + Math.floor(random() * 2))
            break
          case 6:
            deleteAxis(sheet, pick(['row', 'col'] as const), row, 1)
            break
          case 7:
            moveAxis(sheet, 'row', row, 1, Math.floor(random() * 10))
            break
          case 8:
            commands.mergeRanges(sheet, [{ top: row, left: col, bottom: row + 1, right: col + 1 }])
            break
          case 9:
            if (sheets.length < 3) model.addSheet(model.uniqueSheetName(`S${step}`))
            break
          case 10:
            model.renameSheet(sheet.id, model.uniqueSheetName(`Name${step}`))
            break
          case 11:
            sheet.setCell(row, col, undefined)
            break
        }
        if (random() < 0.3) sync(Math.floor(random() * 3), Math.floor(random() * 3))
      }
      sync(0, 1)
      sync(1, 2)
      sync(0, 1)
      const snapshots = models.map(snapshot)
      expect(snapshots[1]).toBe(snapshots[0])
      expect(snapshots[2]).toBe(snapshots[0])
      const codec = new SheetCodec()
      const assets = new MemoryLiveAssetStore()
      const files = await Promise.all(docs.map((doc) => codec.exportFile(doc, { name: 'Fuzz.xlsx', assets })))
      const texts = await Promise.all(
        files.map(async (bytes) => {
          const reread = new Y.Doc()
          await codec.importFile(reread, bytes, { name: 'Fuzz.xlsx', assets })
          return codec.toText(reread)
        }),
      )
      expect(texts[1]).toBe(texts[0])
      expect(texts[2]).toBe(texts[0])
      expect(texts[0]).toBe(codec.toText(docs[0]!))
    })
  }
})
