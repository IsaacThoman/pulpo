import type * as Y from 'yjs'

interface ReadCache { values: WeakMap<Y.Map<unknown>, Map<string, unknown>> }
const caches = new WeakMap<Y.Doc, ReadCache>()

/** Share derived geometry across model wrappers. Any completed transaction invalidates it;
 * reads during a write transaction rebuild so edits in the same batch are visible immediately. */
export function cachedSheetRead<T>(doc: Y.Doc, sheet: Y.Map<unknown>, key: string, build: () => T): T {
  if (doc._transaction?.changed.size) return build()
  let cache = caches.get(doc)
  if (!cache) {
    cache = { values: new WeakMap() }
    caches.set(doc, cache)
    const state = cache
    doc.on('beforeObserverCalls', (transaction: Y.Transaction) => {
      if (transaction.changed.size) state.values = new WeakMap()
    })
  }
  let values = cache.values.get(sheet)
  if (!values) { values = new Map(); cache.values.set(sheet, values) }
  if (!values.has(key)) values.set(key, build())
  return values.get(key) as T
}
