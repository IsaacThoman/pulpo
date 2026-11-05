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

describe('concurrent structure, whichever replica wins', () => {
  /** Two replicas of `base` with the given client ids, edited by `edit`, then synced. */
  function race(base: Y.Doc, clientIds: [number, number], edit: (a: WorkbookModel, b: WorkbookModel) => void): [WorkbookModel, WorkbookModel] {
    const a = new Y.Doc()
    const b = new Y.Doc()
    a.clientID = clientIds[0]
    b.clientID = clientIds[1]
    Y.applyUpdate(a, Y.encodeStateAsUpdate(base))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(base))
    const models: [WorkbookModel, WorkbookModel] = [new WorkbookModel(a), new WorkbookModel(b)]
    edit(...models)
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    return models
  }

  for (const clientIds of [[1, 2], [2, 1]] as [number, number][]) {
    it(`shrinks a range from both ends when its edge rows are deleted at once (clients ${clientIds})`, () => {
      const base = new Y.Doc()
      const sheet = WorkbookModel.initialize(base).addSheet('Sheet1')
      for (let row = 0; row < 12; row++) sheet.setCell(row, 0, { v: row + 1 })
      sheet.setCell(19, 1, { f: toIdForm('SUM(A1:A10)', sheet) })
      // Each deletion rewrites the formula, and only one rewrite survives; the deleted edge of the
      // other must still resolve to its neighbor, not to an index the other deletion shifted.
      const models = race(base, clientIds, (a, b) => {
        deleteAxis(a.sheets()[0]!, 'row', 0, 1)
        deleteAxis(b.sheets()[0]!, 'row', 9, 1)
      })
      for (const model of models) {
        const after = model.sheets()[0]!
        expect(toA1Form(after.cell(17, 1)!.f!, after)).toBe('SUM(A1:A8)')
      }
    })

    it(`keeps a row inserted where another replica stored new rows at the same time (clients ${clientIds})`, () => {
      const base = new Y.Doc()
      const sheet = WorkbookModel.initialize(base).addSheet('Sheet1')
      sheet.setCell(1024, 0, { v: 'original' })
      // Both replicas store the chunk starting at row 2049; the insertion sits beside one copy.
      const models = race(base, clientIds, (a, b) => {
        const left = a.sheets()[0]!
        insertAxis(left, 'row', 2048, 1)
        left.setCell(2048, 0, { v: 'inserted' })
        b.sheets()[0]!.setCell(2048, 0, { v: 'typed' })
      })
      for (const model of models) {
        const after = model.sheets()[0]!
        expect([after.cell(1024, 0)?.v, after.cell(2048, 0)?.v, after.cell(2049, 0)?.v]).toEqual(['original', 'inserted', 'typed'])
      }
    })
  }
})
