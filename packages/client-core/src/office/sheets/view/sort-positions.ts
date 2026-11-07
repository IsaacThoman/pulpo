import type * as Y from 'yjs'
import { formatIdToken, mapIdTokens } from '../model/formula-ids.js'
import type { SheetModel } from '../model/workbook.js'
import type { CellRange } from '../address.js'

/** Capture positions before moving identities. Restore only changed anchors afterwards. */
export function sortPositions(sheet: SheetModel, area: CellRange): () => void {
  const positions = new Map<string, number>()
  for (let row = area.top; row <= area.bottom; row++) positions.set(sheet.rows.idAt(row), row)
  const rowId = (id: string) => positions.has(id) ? sheet.positionRowId(positions.get(id)!) : id
  const reanchor = (value: unknown, context = sheet.id): unknown => {
    if (typeof value === 'string') return mapIdTokens(value, (token, text) => {
      if ((token.sheet ?? context) !== sheet.id) return text
      for (const end of [token.from, token.to]) if (end?.row !== undefined) end.row = rowId(end.row)
      return formatIdToken(token)
    })
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((child) => reanchor(child, context))
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      context === sheet.id && ['top', 'bottom', 'row'].includes(key) && typeof child === 'string' ? rowId(child) : reanchor(child, context),
    ]))
  }
  const maps: Y.Map<unknown>[] = []
  const contexts: string[] = []
  for (const owner of sheet.workbook.sheets()) {
    for (const map of [owner.cf, owner.dv, owner.drawings, owner.merges, owner.tables, owner.filter, owner.raw]) {
      maps.push(map as unknown as Y.Map<unknown>)
      contexts.push(owner.id)
    }
  }
  maps.push(sheet.workbook.names as unknown as Y.Map<unknown>)
  contexts.push(sheet.id)
  const entries = maps.map((map) => [...map.entries()])
  const rowProps = [...sheet.rowMeta.entries()].filter(([key]) => !key.startsWith('~p') && !/\|(hidden|manualHidden)$/.test(key))
  const links = [...sheet.links.entries()].filter(([, raw]) => {
    const range = (raw as { range?: { top?: string; bottom?: string; left?: string; right?: string } }).range
    return range && (range.top?.startsWith('~p') || range.top !== range.bottom || range.left !== range.right)
  })
  return () => {
    sheet.enablePositions()
    maps.forEach((map, i) => {
      for (const [key, value] of entries[i]!) {
        if (/^(sortFormula:|rowPosition:|positionRowSource:)/.test(key)) continue
        const context = (map as unknown) === sheet.workbook.names ? (value as { scope?: string }).scope ?? sheet.id : contexts[i]!
        const next = reanchor(value, context)
        if (JSON.stringify(value) !== JSON.stringify(next)) map.set(key, next)
      }
    })
    for (const [key] of rowProps) {
      const id = key.slice(0, key.indexOf('|'))
      if (sheet.raw.has(`rowPosition:${id}`)) continue
      const positional = sheet.positionRowId(sheet.rows.indexOf(id))
      sheet.raw.set(`rowPosition:${id}`, positional)
      sheet.raw.set(`positionRowSource:${positional}`, id)
    }
    for (const [key] of links) sheet.links.delete(key)
    for (const [key, value] of links) {
      const colon = key.indexOf(':')
      const row = sheet.rows.indexOf(key.slice(0, colon))
      sheet.links.set(sheet.positionRowId(row) + key.slice(colon), reanchor(value))
    }
  }
}
