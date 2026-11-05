import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { strFromU8, unzipSync } from 'fflate'
import { MemoryLiveAssetStore } from '../../assets.js'
import { parseXml } from '../../ooxml/package.js'
import { SheetCalc } from '../calc.js'
import { SheetCodec } from '../codec/codec.js'
import * as commands from '../view/commands.js'
import { idTokens, toA1Form, toIdForm } from './formula-ids.js'
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

/** Captures independent edits before delivering them, so either delivery order is exercised. */
function sheetReplicas(base: Y.Doc, clientIds: number[]) {
  const docs = clientIds.map((clientID) => {
    const doc = new Y.Doc()
    doc.clientID = clientID
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
    return doc
  })
  return {
    docs,
    models: docs.map((doc) => new WorkbookModel(doc)),
    sync(reverse: boolean) {
      const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc))
      if (reverse) updates.reverse()
      for (const doc of docs) for (const update of updates) Y.applyUpdate(doc, update)
    },
  }
}

describe('concurrent sheet invariants', () => {
  for (const count of [2, 3]) for (const descending of [false, true]) for (const reverse of [false, true]) {
    const clientIds = Array.from({ length: count }, (_, index) => index + 1)
    if (descending) clientIds.reverse()
    const label = `clients ${clientIds}, ${reverse ? 'reverse' : 'forward'} delivery`

    it(`resolves colliding names and keeps each formula's sheet identity (${label})`, async () => {
      const base = new Y.Doc()
      base.clientID = 100
      const original = WorkbookModel.initialize(base)
      original.addSheet('Sheet1')
      original.addSheet('Sheet2 (2)')
      const { docs, models, sync } = sheetReplicas(base, clientIds)
      const ownIds = models.map((model, index) => {
        const sheet = model.addSheet('Sheet2')
        sheet.setCell(0, 0, { v: index + 10 })
        sheet.setCell(0, 1, { f: toIdForm('Sheet2!A1', sheet) })
        model.names.set(`name${index}`, { name: `Value${index}`, formula: toIdForm('Sheet2!$A$1', undefined, model) })
        return sheet.id
      })
      const stored = models.map((model, index) => model.sheet(ownIds[index]!)!.cell(0, 1)!.f!)
      const liveCalcs = models.map((model) => new SheetCalc(model))
      sync(reverse)
      const codec = new SheetCodec()
      const context = { name: 'Names.xlsx', assets: new MemoryLiveAssetStore() }
      const expectedNames = ['Sheet1', 'Sheet2 (2)', 'Sheet2', ...Array.from({ length: count - 1 }, (_, index) => `Sheet2 (${index + 3})`)]
      for (const [replica, model] of models.entries()) {
        expect(model.sheets().map((sheet) => sheet.name)).toEqual(expectedNames)
        const calc = new SheetCalc(model, { live: false })
        for (const [index, id] of ownIds.entries()) {
          const sheet = model.sheet(id)!
          expect(sheet.map.get('name')).toBe('Sheet2')
          expect(model.sheetByName(sheet.name.toUpperCase())?.id).toBe(id)
          expect(sheet.cell(0, 1)!.f).toBe(stored[index])
          expect(idTokens(sheet.cell(0, 1)!.f!)[0]!.sheet).toBe(id)
          expect(toIdForm(toA1Form(stored[index]!, sheet), sheet)).toBe(stored[index])
          expect(calc.get(sheet, 0, 1)).toBe(index + 10)
          expect(liveCalcs[replica]!.get(sheet, 0, 1)).toBe(index + 10)
          expect(codec.toText(model.doc)).toContain(toA1Form(stored[index]!, sheet))
        }
        const file = await codec.exportFile(model.doc, context)
        const xml = parseXml(strFromU8(unzipSync(file)['xl/workbook.xml']!))
        const exportedNames = Array.from(xml.getElementsByTagName('sheet')).map((sheet) => sheet.getAttribute('name'))
        expect(exportedNames).toEqual(expectedNames)
        const reread = new Y.Doc()
        await codec.importFile(reread, file, context)
        const reopened = new WorkbookModel(reread)
        const reopenedCalc = new SheetCalc(reopened, { live: false })
        for (const [index, id] of ownIds.entries()) {
          const sheet = reopened.sheetByName(model.sheet(id)!.name)!
          expect(sheet.cell(0, 0)?.v).toBe(index + 10)
          expect(reopenedCalc.get(sheet, 0, 1)).toBe(index + 10)
          const name = [...reopened.names.values()].find((entry) => entry.name === `Value${index}`)!
          expect(toA1Form(name.formula, undefined, reopened)).toBe(toA1Form(model.names.get(`name${index}`)!.formula, undefined, model))
        }
        calc.destroy()
        reopenedCalc.destroy()
        reread.destroy()
      }
      for (const calc of liveCalcs) calc.destroy()
      for (const doc of docs) doc.destroy()
      base.destroy()
    })

    for (const operation of ['delete', 'hide'] as const) {
      it(`keeps a live visible sheet after every sheet is concurrently ${operation === 'delete' ? 'deleted' : 'hidden'} (${label})`, async () => {
        const base = new Y.Doc()
        base.clientID = 100
        const original = WorkbookModel.initialize(base)
        const ids = Array.from({ length: count }, (_, index) => {
          const sheet = original.addSheet(`Sheet${index + 1}`)
          sheet.setCell(0, 0, { v: index + 10 })
          sheet.setCell(0, 1, { f: toIdForm('A1+1', sheet) })
          original.names.set(`name${index}`, { name: 'LocalValue', scope: sheet.id, formula: toIdForm('A1', sheet) })
          return sheet.id
        })
        const { docs, models, sync } = sheetReplicas(base, clientIds)
        const calcs = models.map((model) => new SheetCalc(model))
        models.forEach((model, index) => {
          if (operation === 'delete') model.deleteSheet(ids[index]!)
          else model.setSheetState(ids[index]!, index % 2 ? 'veryHidden' : 'hidden')
        })
        sync(reverse)
        const codec = new SheetCodec()
        const context = { name: 'Fallback.xlsx', assets: new MemoryLiveAssetStore() }
        for (const [replica, model] of models.entries()) {
          expect(model.order.toArray()).toEqual(ids)
          expect(model.sheetIds()).toEqual(operation === 'delete' ? ids.slice(0, 1) : ids)
          expect(model.sheets().filter((sheet) => sheet.state === 'visible').map((sheet) => sheet.id)).toEqual([ids[0]])
          const first = model.sheet(ids[0]!)!
          expect(first.cell(0, 0)?.v).toBe(10)
          expect(calcs[replica]!.get(first, 0, 1)).toBe(11)
          expect([...model.names.keys()]).toEqual(operation === 'delete' ? ['name0'] : ids.map((_, index) => `name${index}`))
          expect(model.names.get('name0')?.scope).toBe(ids[0])
          if (operation === 'delete') for (const [index, id] of ids.entries()) {
            expect(model.sheetsMap.get(id)!.get('deleted')).toBe(true)
            expect(model.sheet(id)?.id).toBe(index === 0 ? id : undefined)
            expect(model.sheetByName(`Sheet${index + 1}`)?.id).toBe(index === 0 ? id : undefined)
            expect(model.names.get(`name${index}`)?.scope).toBe(index === 0 ? id : undefined)
          }
          const file = await codec.exportFile(model.doc, context)
          const reread = new Y.Doc()
          await codec.importFile(reread, file, context)
          const reopened = new WorkbookModel(reread)
          expect(reopened.sheets().map((sheet) => [sheet.name, sheet.state, sheet.cell(0, 0)?.v])).toEqual(model.sheets().map((sheet) => [sheet.name, sheet.state, sheet.cell(0, 0)?.v]))
          expect([...reopened.names.values()].map((name) => name.name)).toEqual([...model.names.values()].map((name) => name.name))
          reread.destroy()
        }
        for (const calc of calcs) calc.destroy()
        for (const doc of docs) doc.destroy()
        base.destroy()
      })
    }
  }
})
