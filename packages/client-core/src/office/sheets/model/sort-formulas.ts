import * as Y from 'yjs'
import { formatIdToken, mapIdTokens, toA1Form, toIdForm } from './formula-ids.js'
import type { CellRange } from '../address.js'
import type { SheetModel } from './workbook.js'

export interface SortedFormula { source: string; f: string }
export function cellVersion(sheet: SheetModel, key: string): string {
  const id = sheet.cells._map.get(key)?.id
  return id ? `${id.client}:${id.clock}` : ''
}

/** Keep relocation separate from CellData: a concurrent replacement always owns its cell. */
export function sortedFormula(sheet: SheetModel, key: string, f: string, area: CellRange): SortedFormula {
  const own = sheet.position(key)!.row
  return { source: cellVersion(sheet, key), f: mapIdTokens(toIdForm(toA1Form(f, sheet), sheet), (token, text) => {
    if (token.sheet && token.sheet !== sheet.id) return text
    for (const end of [token.from, token.to]) {
      if (end?.row === undefined) continue
      const row = sheet.rows.indexOf(end.row)
      if (row < area.top || row > area.bottom) continue
      end.row = end.rowAbs ? (`~p${sheet.positionRows.order.length ? sheet.positionRows.idAt(row) : sheet.rows.idAt(row)}`) : row === own ? sheet.rows.idAt(own) : `~r${sheet.rows.idAt(own)}_${row - own}`
    }
    return formatIdToken(token)
  }) }
}

/** Relative sort offsets become ordinary identities before a subsequent structural edit. */
export function freezeSortFormulas(sheet: SheetModel): void {
  for (const [key, raw] of sheet.raw) {
    if (!key.startsWith('sortFormula:')) continue
    const formula = raw as SortedFormula
    const f = mapIdTokens(formula.f, (token) => {
      for (const end of [token.from, token.to]) if (end?.row?.startsWith('~r')) {
        const row = sheet.rows.indexOf(end.row)
        if (row < 0 || row >= 1048576) return '#REF!'
        end.row = sheet.rows.idAt(row)
      }
      return formatIdToken(token)
    })
    if (f !== formula.f) sheet.raw.set(key, { ...formula, f })
  }
}

/** Undo recreates an Item. Carry the adjustment to that Item and synchronize the new gate. */
export function rebindSortedFormulas(sheet: SheetModel): void {
  for (const [key, raw] of sheet.raw) {
    if (!key.startsWith('sortFormula:')) continue
    const formula = raw as SortedFormula
    const cellKey = key.slice('sortFormula:'.length)
    const current = sheet.cells._map.get(cellKey)?.id
    if (!current || formula.source === `${current.client}:${current.clock}`) continue
    const [client, clock] = formula.source.split(':').map(Number)
    let id = Y.createID(client!, clock!)
    const seen = new Set<string>()
    while (!seen.has(`${id.client}:${id.clock}`) && id.clock < Y.getState(sheet.workbook.doc.store, id.client)) {
      seen.add(`${id.client}:${id.clock}`)
      const item = Y.getItem(sheet.workbook.doc.store, id)
      if (!item.redone) break
      id = item.redone
      if (id.client === current.client && id.clock === current.clock) {
        sheet.raw.set(key, { ...formula, source: `${id.client}:${id.clock}` })
        break
      }
    }
  }
}

/** Formulas outside the sorted records continue to refer to worksheet positions. */
export function outsideSortFormulas(sheet: SheetModel, area: CellRange): () => void {
  const pending: { owner: SheetModel; key: string; formula: SortedFormula }[] = []
  for (const owner of sheet.workbook.sheets()) owner.forEachCell((row, col, data, key) => {
    if (data.f === undefined || owner === sheet && row >= area.top && row <= area.bottom && col >= area.left && col <= area.right) return
    const f = mapIdTokens(data.f, (token, text) => {
      if ((token.sheet ?? owner.id) !== sheet.id) return text
      for (const end of [token.from, token.to]) {
        if (end?.row === undefined) continue
        const r = sheet.rows.indexOf(end.row)
        if (r >= area.top && r <= area.bottom) end.row = `~p${sheet.positionRows.order.length ? sheet.positionRows.idAt(r) : sheet.rows.idAt(r)}`
      }
      return formatIdToken(token)
    })
    if (f !== data.f) pending.push({ owner, key, formula: { source: cellVersion(owner, key), f } })
  })
  return () => { for (const { owner, key, formula } of pending) owner.raw.set(`sortFormula:${key}`, formula) }
}
