import * as Y from 'yjs'

/** The part of expo-sqlite's async database the document store uses (and tests replace). */
export interface DocDatabase {
  runAsync(source: string, ...params: Array<string | number | Uint8Array | null>): Promise<unknown>
  getFirstAsync<T>(source: string, ...params: Array<string | number | Uint8Array | null>): Promise<T | null>
  getAllAsync<T>(source: string, ...params: Array<string | number | Uint8Array | null>): Promise<T[]>
  withTransactionAsync(task: () => Promise<void>): Promise<void>
}

/** Runs one database operation at a time, in order, so a document's writes never interleave. */
export type DatabaseRunner = <T>(operation: (database: DocDatabase) => Promise<T>) => Promise<T>

export interface StoredDoc {
  /** Every stored update merged, or null when this device has no copy. */
  update: Uint8Array | null
  schemaVersion: number | null
  /** Edits made here that the server has not acknowledged yet. */
  dirty: boolean
}

/** Log rows past which a document's stored copy is folded into one snapshot. */
export const COMPACT_AFTER_UPDATES = 100
/** Copies kept on this device without unsynced edits, most recently opened first. */
export const MAX_CLEAN_DOCS = 60

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('Stored document data is not binary')
}

/**
 * Each opened document's local copy: a snapshot plus a log of later updates, in SQLite.
 * Documents with unsynced edits (`dirty`) are never evicted, and are what the background flush
 * uploads when the app reconnects.
 */
export class DocStore {
  constructor(private readonly run: DatabaseRunner) {}

  load(namespace: string, docId: string): Promise<StoredDoc> {
    return this.run(async (database) => {
      const row = await database.getFirstAsync<{ state: unknown; schema_version: number; dirty: number }>(
        'SELECT state, schema_version, dirty FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId,
      )
      if (!row) return { update: null, schemaVersion: null, dirty: false }
      const updates = await database.getAllAsync<{ data: unknown }>(
        'SELECT data FROM file_doc_updates WHERE namespace = ? AND doc_id = ? ORDER BY id', namespace, docId,
      )
      await database.runAsync('UPDATE file_docs SET opened_at = ? WHERE namespace = ? AND doc_id = ?', Date.now(), namespace, docId)
      const all = [bytes(row.state), ...updates.map((update) => bytes(update.data))]
      return { update: all.length === 1 ? all[0]! : Y.mergeUpdates(all), schemaVersion: row.schema_version, dirty: row.dirty === 1 }
    })
  }

  /**
   * Appends updates to the document's copy, creating it from `snapshot` when there is none, and
   * marks it dirty when any of them are local. Compacts into `snapshot()` once the log is long.
   */
  append(namespace: string, docId: string, updates: Uint8Array[], options: { local: boolean; schemaVersion: number; snapshot: () => Uint8Array }): Promise<void> {
    if (!updates.length) return Promise.resolve()
    return this.run(async (database) => {
      await database.withTransactionAsync(async () => {
        const row = await database.getFirstAsync<{ count: number }>(
          `SELECT (SELECT COUNT(*) FROM file_doc_updates WHERE namespace = ? AND doc_id = ?) AS count
           FROM file_docs WHERE namespace = ? AND doc_id = ?`, namespace, docId, namespace, docId,
        )
        if (!row || row.count + 1 >= COMPACT_AFTER_UPDATES) {
          await this.writeSnapshot(database, namespace, docId, options.snapshot(), options.schemaVersion, options.local)
          return
        }
        const merged = updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates)
        await database.runAsync('INSERT INTO file_doc_updates(namespace, doc_id, data) VALUES (?, ?, ?)', namespace, docId, merged)
        await database.runAsync(
          `UPDATE file_docs SET size_bytes = size_bytes + ?, schema_version = ?, dirty = MAX(dirty, ?), opened_at = ?
           WHERE namespace = ? AND doc_id = ?`,
          merged.byteLength, options.schemaVersion, options.local ? 1 : 0, Date.now(), namespace, docId,
        )
      })
    })
  }

  /** Folds the log into one snapshot of the document as it is now. */
  compact(namespace: string, docId: string, snapshot: Uint8Array, schemaVersion: number): Promise<void> {
    return this.run(async (database) => {
      const row = await database.getFirstAsync<{ dirty: number }>('SELECT dirty FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId)
      if (!row) return
      await database.withTransactionAsync(() => this.writeSnapshot(database, namespace, docId, snapshot, schemaVersion, false))
    })
  }

  /** The server has every edit made here so far. */
  markSynced(namespace: string, docId: string): Promise<void> {
    return this.run(async (database) => {
      await database.runAsync('UPDATE file_docs SET dirty = 0 WHERE namespace = ? AND doc_id = ? AND dirty = 1', namespace, docId)
    })
  }

  dirtyDocIds(namespace: string): Promise<string[]> {
    return this.run(async (database) => {
      const rows = await database.getAllAsync<{ doc_id: string }>(
        'SELECT doc_id FROM file_docs WHERE namespace = ? AND dirty = 1 ORDER BY opened_at DESC', namespace,
      )
      return rows.map((row) => row.doc_id)
    })
  }

  /** Forgets a copy unless it holds edits not uploaded yet (which may still find their document). */
  removeIfClean(namespace: string, docId: string): Promise<boolean> {
    return this.run(async (database) => {
      const row = await database.getFirstAsync<{ dirty: number }>('SELECT dirty FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId)
      if (!row || row.dirty === 1) return false
      await database.withTransactionAsync(async () => {
        await database.runAsync('DELETE FROM file_doc_updates WHERE namespace = ? AND doc_id = ?', namespace, docId)
        await database.runAsync('DELETE FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId)
      })
      return true
    })
  }

  /** Forgets a copy, e.g. once its document was permanently deleted. */
  remove(namespace: string, docId: string): Promise<void> {
    return this.run(async (database) => {
      await database.withTransactionAsync(async () => {
        await database.runAsync('DELETE FROM file_doc_updates WHERE namespace = ? AND doc_id = ?', namespace, docId)
        await database.runAsync('DELETE FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId)
      })
    })
  }

  /** Drops the least recently opened copies without unsynced edits, keeping `keep` of them and those open. */
  evict(namespace: string, open: readonly string[], keep = MAX_CLEAN_DOCS): Promise<string[]> {
    return this.run(async (database) => {
      const rows = await database.getAllAsync<{ doc_id: string }>(
        'SELECT doc_id FROM file_docs WHERE namespace = ? AND dirty = 0 ORDER BY opened_at DESC', namespace,
      )
      const removed = rows.slice(keep).map((row) => row.doc_id).filter((docId) => !open.includes(docId))
      if (!removed.length) return []
      await database.withTransactionAsync(async () => {
        for (const docId of removed) {
          await database.runAsync('DELETE FROM file_doc_updates WHERE namespace = ? AND doc_id = ?', namespace, docId)
          await database.runAsync('DELETE FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId)
        }
      })
      return removed
    })
  }

  /**
   * Replaces a copy's log with one snapshot. The snapshot is merged with what is stored rather than
   * replacing it, so a write from another session of the same document (two can overlap while one
   * restarts) is never dropped; merging Yjs updates is idempotent.
   */
  private async writeSnapshot(database: DocDatabase, namespace: string, docId: string, snapshot: Uint8Array, schemaVersion: number, local: boolean): Promise<void> {
    const stored = await database.getFirstAsync<{ state: unknown }>('SELECT state FROM file_docs WHERE namespace = ? AND doc_id = ?', namespace, docId)
    const updates = await database.getAllAsync<{ id: number; data: unknown }>(
      'SELECT id, data FROM file_doc_updates WHERE namespace = ? AND doc_id = ? ORDER BY id', namespace, docId,
    )
    const parts = [...(stored ? [bytes(stored.state)] : []), ...updates.map((update) => bytes(update.data)), snapshot]
    const merged = parts.length === 1 ? snapshot : Y.mergeUpdates(parts)
    const lastId = updates.at(-1)?.id
    if (lastId !== undefined) await database.runAsync('DELETE FROM file_doc_updates WHERE namespace = ? AND doc_id = ? AND id <= ?', namespace, docId, lastId)
    await database.runAsync(
      `INSERT INTO file_docs(namespace, doc_id, state, schema_version, dirty, size_bytes, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, doc_id) DO UPDATE SET state = excluded.state, schema_version = excluded.schema_version,
         dirty = MAX(file_docs.dirty, excluded.dirty), size_bytes = excluded.size_bytes, opened_at = excluded.opened_at`,
      namespace, docId, merged, schemaVersion, local ? 1 : 0, merged.byteLength, Date.now(),
    )
  }
}
