import * as Y from 'yjs'
import { WORKBOOK_MAP } from '../layout.js'

/** Imports seed file caches and must not be treated as user edits. */
export const IMPORT_ORIGIN = Symbol('sheet-import')
const EDIT_ORIGIN = Symbol('sheet-edits')

/** Records a calculation snapshot without writing metadata on every keystroke. */
export function markCalcDirty(doc: Y.Doc): void {
  const meta = doc.getMap(WORKBOOK_MAP).get('meta') as Y.Map<unknown> | undefined
  if (!meta) return
  const now = Date.now()
  const previous = meta.get('calcTime')
  doc.transact(() => {
    if (meta.get('calcDirty') !== true) meta.set('calcDirty', true)
    if (typeof previous !== 'number' || now - previous > 60_000) meta.set('calcTime', now)
  }, EDIT_ORIGIN)
}

/** Marks local workbook changes while remote updates keep their author's calculation snapshot. */
export function trackEdits(doc: Y.Doc): () => void {
  const root = doc.getMap(WORKBOOK_MAP)
  const afterTransaction = (transaction: Y.Transaction) => {
    if (!transaction.local || transaction.origin === IMPORT_ORIGIN || transaction.origin === EDIT_ORIGIN) return
    const meta = root.get('meta')
    const events = [...transaction.changedParentTypes].find(([type]) => (type as unknown) === root)?.[1] ?? []
    const edited = events.some((event) => event.target !== meta || [...(event as Y.YMapEvent<unknown>).keysChanged].some((key) => key !== 'calcDirty' && key !== 'calcTime'))
    if (edited) markCalcDirty(doc)
  }
  doc.on('afterTransaction', afterTransaction)
  return () => doc.off('afterTransaction', afterTransaction)
}
