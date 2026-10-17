import type { FileListing, FileNode } from '@pulpo/contracts'
import { File } from 'expo-file-system'
import { attachmentEvictionPlan } from '../../data/schema'
import { getValue, setValue, withMobileDatabase } from '../../data/database'
import { usePreferencesStore } from '../../store/preferences'

/*
 * What Files keeps on this device besides documents (see doc/store.ts): the last listing of each
 * opened folder and item, for browsing offline, and downloaded file contents under an LRU quota.
 */

const listingKey = (folderId: string | null) => `files:folder:${folderId ?? 'root'}`
const nodeKey = (id: string) => `files:node:${id.toLowerCase()}`

export function cachedListing(namespace: string, folderId: string | null): Promise<FileListing | null> {
  return getValue<FileListing>(namespace, listingKey(folderId))
}

export function cacheListing(namespace: string, folderId: string | null, listing: FileListing): Promise<void> {
  return setValue(namespace, listingKey(folderId), listing)
}

export function cachedNode(namespace: string, id: string): Promise<{ node: FileNode; ancestors: FileNode[] } | null> {
  return getValue(namespace, nodeKey(id))
}

export function cacheNode(namespace: string, value: { node: FileNode; ancestors: FileNode[] }): Promise<void> {
  return setValue(namespace, nodeKey(value.node.id), value)
}

export async function cachedFileUri(namespace: string, nodeId: string, version: string): Promise<string | null> {
  return withMobileDatabase(async (database) => {
    const row = await database.getFirstAsync<{ local_uri: string; version: string }>(
      'SELECT local_uri, version FROM file_cache WHERE namespace = ? AND node_id = ?', namespace, nodeId,
    )
    if (!row || row.version !== version) return null
    await database.runAsync('UPDATE file_cache SET last_accessed = ? WHERE namespace = ? AND node_id = ?', Date.now(), namespace, nodeId)
    return row.local_uri
  })
}

/** Records a downloaded file and removes the least recently used ones past the download quota. */
export async function recordCachedFile(namespace: string, nodeId: string, version: string, file: File): Promise<void> {
  const quotaBytes = Math.max(usePreferencesStore.getState().attachmentCacheMb * 1024 * 1024, file.size)
  const evicted = await withMobileDatabase(async (database) => {
    // A copy kept under an earlier name (the path follows it) is replaced, not left behind.
    const previous = await database.getFirstAsync<{ local_uri: string }>(
      'SELECT local_uri FROM file_cache WHERE namespace = ? AND node_id = ?', namespace, nodeId,
    )
    await database.runAsync(
      `INSERT INTO file_cache(namespace, node_id, version, local_uri, size_bytes, last_accessed) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, node_id) DO UPDATE SET version = excluded.version, local_uri = excluded.local_uri,
         size_bytes = excluded.size_bytes, last_accessed = excluded.last_accessed`,
      namespace, nodeId, version, file.uri, file.size, Date.now(),
    )
    const rows = await database.getAllAsync<{ node_id: string; local_uri: string; size_bytes: number; last_accessed: number }>(
      'SELECT node_id, local_uri, size_bytes, last_accessed FROM file_cache WHERE namespace = ?', namespace,
    )
    const plan = attachmentEvictionPlan(rows.map((row) => ({
      attachmentId: row.node_id, localUri: row.local_uri, sizeBytes: row.size_bytes, lastAccessed: row.last_accessed,
    })), quotaBytes)
    for (const record of plan) await database.runAsync('DELETE FROM file_cache WHERE namespace = ? AND node_id = ?', namespace, record.attachmentId)
    const removed = plan.map((record) => record.localUri)
    return previous && previous.local_uri !== file.uri ? [...removed, previous.local_uri] : removed
  })
  for (const uri of evicted) {
    try {
      const cached = new File(uri)
      if (cached.exists && uri !== file.uri) cached.delete()
    } catch {
      // Already gone; the table is authoritative.
    }
  }
}
