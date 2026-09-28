import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { DOC_SCHEMA_VERSION, ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import type { FileNode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileDocs, fileDocUpdates, fileNodes } from '../database/schema.js'
import { fileDocQueue } from '../jobs.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { resolveFileAccess } from './access.js'
import { docTooLarge, initialDocState, MAX_DOC_STATE_BYTES } from './doc-state.js'
import { assertDestination, availableName, mutateFileTree, toFileNode } from './tree-service.js'

export const MAX_DOC_UPDATE_BYTES = 1_000_000
// Re-exported for callers that import document limits from the store.
export { docTooLarge, initialDocState, MAX_DOC_STATE_BYTES }

/** Compact after this many logged updates even while editing continues. */
const COMPACT_EVERY_UPDATES = 100
/** First compaction after an edit burst waits this long so it can fold the whole burst. */
const COMPACT_DELAY_MS = 15_000
export const DEFAULT_DOC_NAME = 'Untitled.md'

export type DocUpdateOrigin = 'client' | 'agent' | 'import' | 'restore'

export const invalidDocUpdate = () => new AppError(400, 'invalid_update', 'The document update is invalid')

export async function createDoc(userId: string, input: { parentId: string | null; name?: string; markdown?: string }): Promise<FileNode> {
  const initial = initialDocState(input.markdown)
  return mutateFileTree(userId, async (tx) => {
    await assertDestination(tx, userId, input.parentId)
    const name = await availableName(tx, userId, input.parentId, input.name ?? DEFAULT_DOC_NAME)
    const [node] = await tx.insert(fileNodes).values({
      id: newId(), ownerUserId: userId, parentId: input.parentId, kind: 'doc', name,
      mimeType: 'text/markdown', sizeBytes: initial.state.byteLength,
    }).returning()
    await tx.insert(fileDocs).values({
      nodeId: node!.id, state: initial.state, stateBytes: initial.state.byteLength,
      markdown: initial.markdown, schemaVersion: DOC_SCHEMA_VERSION,
    })
    return toFileNode(node!)
  })
}

export async function scheduleDocCompaction(nodeId: string, delay = COMPACT_DELAY_MS): Promise<void> {
  // One queued compaction per document per window; later updates are picked up by the same run.
  await fileDocQueue.add('compact', { nodeId }, { delay, deduplication: { id: `compact:${nodeId}`, ttl: delay || 1_000 } })
}

/** Durably records one Yjs update. Callers broadcast it only after this resolves. */
export async function appendDocUpdate(input: {
  nodeId: string
  actorUserId: string | null
  update: Uint8Array
  origin: DocUpdateOrigin
}): Promise<void> {
  if (!input.update.byteLength || input.update.byteLength > MAX_DOC_UPDATE_BYTES) throw invalidDocUpdate()
  try {
    Y.decodeUpdate(input.update)
  } catch {
    throw invalidDocUpdate()
  }
  const pending = await db.transaction(async (tx) => {
    const [doc] = await tx.select({ stateBytes: fileDocs.stateBytes }).from(fileDocs).where(eq(fileDocs.nodeId, input.nodeId))
    if (!doc) throw notFound('Document')
    if (doc.stateBytes > MAX_DOC_STATE_BYTES) throw docTooLarge()
    // Insert before touching the doc row: compaction holds that row lock, and an uncommitted
    // log row is invisible to it, so compaction can never delete an update it did not fold in.
    await tx.insert(fileDocUpdates).values({
      nodeId: input.nodeId, update: input.update, byteSize: input.update.byteLength,
      origin: input.origin, actorUserId: input.actorUserId,
    })
    const [row] = await tx.update(fileDocs).set({
      pendingUpdates: sql`${fileDocs.pendingUpdates} + 1`,
      lastEditedAt: new Date(),
    }).where(eq(fileDocs.nodeId, input.nodeId)).returning({ pendingUpdates: fileDocs.pendingUpdates })
    return row!.pendingUpdates
  })
  if (pending === 1) await scheduleDocCompaction(input.nodeId)
  else if (pending % COMPACT_EVERY_UPDATES === 0) await scheduleDocCompaction(input.nodeId, 0)
}

/**
 * The full document as one Yjs update: the compacted state merged with every logged update.
 * Repeatable read gives a consistent pair even if compaction commits between the two reads.
 */
export async function loadDocUpdate(nodeId: string): Promise<Uint8Array> {
  return db.transaction(async (tx) => {
    const [doc] = await tx.select({ state: fileDocs.state }).from(fileDocs).where(eq(fileDocs.nodeId, nodeId))
    if (!doc) throw notFound('Document')
    const rows = await tx.select({ update: fileDocUpdates.update }).from(fileDocUpdates)
      .where(eq(fileDocUpdates.nodeId, nodeId)).orderBy(asc(fileDocUpdates.seq))
    return rows.length ? Y.mergeUpdates([doc.state, ...rows.map((row) => row.update)]) : doc.state
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function loadYDoc(nodeId: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, await loadDocUpdate(nodeId))
  return doc
}

/** Worker: folds logged updates into the snapshot, then deletes exactly the rows it folded. */
export async function compactDoc(nodeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(fileDocs).where(eq(fileDocs.nodeId, nodeId)).for('update')
    if (!doc) return
    const rows = await tx.select({ seq: fileDocUpdates.seq, update: fileDocUpdates.update }).from(fileDocUpdates)
      .where(eq(fileDocUpdates.nodeId, nodeId)).orderBy(asc(fileDocUpdates.seq))
    if (!rows.length) return
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, doc.state)
    for (const row of rows) Y.applyUpdate(ydoc, row.update)
    const state = Y.encodeStateAsUpdate(ydoc)
    let markdown = doc.markdown
    try {
      markdown = ydocToMarkdown(ydoc)
    } catch (error) {
      // The snapshot is still authoritative; stale Markdown only affects previews and export.
      console.error(JSON.stringify({ level: 'error', event: 'file_doc.markdown_failed', nodeId, error: error instanceof Error ? error.message : String(error) }))
    }
    await tx.update(fileDocs).set({
      state,
      stateBytes: state.byteLength,
      pendingUpdates: sql`greatest(${fileDocs.pendingUpdates} - ${rows.length}, 0)`,
      markdown,
      updatedAt: new Date(),
    }).where(eq(fileDocs.nodeId, nodeId))
    // A seq watermark would be unsafe: identity values can commit out of order.
    await tx.delete(fileDocUpdates).where(inArray(fileDocUpdates.seq, rows.map((row) => row.seq)))
    await tx.update(fileNodes).set({ sizeBytes: state.byteLength, updatedAt: doc.lastEditedAt }).where(eq(fileNodes.id, nodeId))
  })
}

/** Maintenance safety net for compactions a deduplicated schedule may have skipped. */
export async function scheduleStaleDocCompactions(now = new Date()): Promise<void> {
  const stale = await db.select({ nodeId: fileDocs.nodeId }).from(fileDocs).where(and(
    gt(fileDocs.pendingUpdates, 0),
    lt(fileDocs.lastEditedAt, new Date(now.getTime() - 60_000)),
  )).limit(500)
  for (const doc of stale) await scheduleDocCompaction(doc.nodeId, 0)
}

export async function readDocMarkdown(userId: string, nodeId: string): Promise<{ name: string; markdown: string }> {
  const access = await resolveFileAccess(db, userId, nodeId)
  if (!access || access.node.kind !== 'doc') throw notFound('Document')
  const [doc] = await db.select({ markdown: fileDocs.markdown, pendingUpdates: fileDocs.pendingUpdates })
    .from(fileDocs).where(eq(fileDocs.nodeId, nodeId))
  if (!doc) throw notFound('Document')
  if (!doc.pendingUpdates) return { name: access.node.name, markdown: doc.markdown }
  return { name: access.node.name, markdown: ydocToMarkdown(await loadYDoc(nodeId)) }
}
