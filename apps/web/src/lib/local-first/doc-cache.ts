/** IndexedDB databases that y-indexeddb keeps per collaborative document. */
const DOC_CACHE_PREFIX = 'pulpo-doc:'

export function docCacheName(accountKey: string, docId: string): string {
  return `${DOC_CACHE_PREFIX}${accountKey}:${docId}`
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

export async function clearDocCache(accountKey: string, docId: string): Promise<void> {
  if (typeof indexedDB !== 'undefined') await deleteDatabase(docCacheName(accountKey, docId))
}

/** Removes every cached document for an account, e.g. on sign-out. */
export async function clearDocCaches(accountKey: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return
  const prefix = `${DOC_CACHE_PREFIX}${accountKey}:`
  const databases = await indexedDB.databases().catch(() => [])
  await Promise.all(databases.flatMap((database) => database.name?.startsWith(prefix) ? [deleteDatabase(database.name)] : []))
}
