import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { liveMimeType } from '@pulpo/client-core/office'
import { liveFormatCodec } from '@pulpo/client-core/office/codecs'
import type { FileNode } from '@pulpo/contracts'
import { assertStorageCapacity, assertWithinStorageAllowance, lockAccountStorage } from '../attachments/storage-quota.js'
import { db } from '../database/client.js'
import { fileDocAssets, fileDocs, fileDocUpdates, fileNodes } from '../database/schema.js'
import { fileDocQueue } from '../jobs.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { resolveFileAccess, type FileNodeRow } from './access.js'
import { docTooLarge, initialDocState, MAX_DOC_STATE_BYTES, mergedDocState } from './doc-state.js'
import { ASSET_GRACE_MS, collectUnusedAssets } from './asset-gc.js'
import { deleteObjects, docFormat, formatForName, initialLiveDoc } from './live-docs.js'
import { assertDestination, assertNameAvailable, availableName, lockFileTree, mutateFileTree, toFileNode } from './tree-service.js'
import { topSortOrder } from './order.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// A reconnect can upload the entire offline document, and a paste is one transaction.
// Both must be able to send any document the store already supports.
export const MAX_DOC_UPDATE_BYTES = MAX_DOC_STATE_BYTES
// Re-exported for callers that import document limits from the store.
export { docTooLarge, initialDocState, MAX_DOC_STATE_BYTES }

/** Compact after this many logged updates even while editing continues. */
const COMPACT_EVERY_UPDATES = 100
/** First compaction after an edit burst waits this long so it can fold the whole burst. */
const COMPACT_DELAY_MS = 15_000
export const DEFAULT_DOC_NAME = 'Untitled.md'

export type DocUpdateOrigin = 'client' | 'agent' | 'import' | 'restore'

export const invalidDocUpdate = () => new AppError(400, 'invalid_update', 'The document update is invalid')

/**
 * Creates a document inside a tree transaction, in the live format its name's extension picks: an
 * empty one, or one holding `markdown` (Markdown documents) or the file `bytes`. A taken name gets
 * a ` (n)` suffix unless `exactName` is set, in which case it fails.
 */
export async function createDocInTx(tx: DatabaseTransaction, userId: string, input: {
  parentId: string | null
  name?: string
  markdown?: string
  bytes?: Uint8Array
  exactName?: boolean
  suggestionChangeId?: string | null
  /** Collects asset objects as they are stored, for the caller to delete if the transaction fails. */
  writtenKeys?: string[]
}): Promise<FileNodeRow> {
  const desired = input.name ?? DEFAULT_DOC_NAME
  // Only names of a live format are documents; any other name is an ordinary file.
  const format = formatForName(desired)
  if (input.markdown !== undefined && format.id !== 'markdown') throw new AppError(400, 'validation_error', 'Only Markdown documents start from Markdown')
  const initial = await initialLiveDoc(tx, format, desired, { bytes: input.bytes, markdown: input.markdown })
  await assertDestination(tx, userId, input.parentId)
  if (input.exactName) await assertNameAvailable(tx, userId, input.parentId, desired)
  const name = input.exactName ? desired : await availableName(tx, userId, input.parentId, desired)
  const [node] = await tx.insert(fileNodes).values({
    id: newId(), ownerUserId: userId, parentId: input.parentId, kind: 'doc', name, format: format.id,
    mimeType: liveMimeType(format, name), sizeBytes: initial.state.byteLength,
    sortOrder: await topSortOrder(tx, userId, input.parentId), suggestionChangeId: input.suggestionChangeId ?? null,
  }).returning()
  await tx.insert(fileDocs).values({
    nodeId: node!.id, state: initial.state, stateBytes: initial.state.byteLength,
    markdown: initial.text, schemaVersion: format.schemaVersion, generation: initial.generation,
  })
  const written = await initial.assets.flush(tx, userId, node!.id)
  input.writtenKeys?.push(...written)
  return node!
}

export async function createDoc(userId: string, input: { parentId: string | null; name?: string; markdown?: string }): Promise<FileNode> {
  return mutateFileTree(userId, async (tx) => {
    const node = await createDocInTx(tx, userId, input)
    await assertWithinStorageAllowance(tx, userId)
    return toFileNode(node)
  })
}

export async function scheduleDocCompaction(nodeId: string, delay = COMPACT_DELAY_MS): Promise<void> {
  // One queued compaction per document per window; later updates are picked up by the same run.
  await fileDocQueue.add('compact', { nodeId }, { delay, deduplication: { id: `compact:${nodeId}`, ttl: delay || 1_000 } })
}

/** Revisit uploads after their grace period, even if nobody edits the document again. */
export async function scheduleDocAssetCollection(nodeId: string, delay = ASSET_GRACE_MS + 1_000): Promise<void> {
  await fileDocQueue.add('compact', { nodeId }, { delay, deduplication: { id: `assets:${nodeId}`, ttl: 1_000 } })
}

export interface DocUpdateInput {
  nodeId: string
  /** Revalidates a socket writer under the tree lock, including trash/conversion races. */
  ownerUserId?: string
  actorUserId: string | null
  update: Uint8Array
  origin: DocUpdateOrigin
  /** Updates the server computes itself may be larger than what clients may send. */
  maxBytes?: number
}

/**
 * Records one Yjs update inside the caller's transaction and returns the document's count of
 * logged updates, which `scheduleCompactionAfterUpdate` needs once the transaction commits.
 */
export async function appendDocUpdateInTx(tx: DatabaseTransaction, input: DocUpdateInput): Promise<number> {
  if (!input.update.byteLength || input.update.byteLength > (input.maxBytes ?? MAX_DOC_UPDATE_BYTES)) throw invalidDocUpdate()
  try {
    Y.decodeUpdate(input.update)
  } catch {
    throw invalidDocUpdate()
  }
  const [node] = await tx.select({ ownerUserId: fileNodes.ownerUserId, sizeBytes: fileNodes.sizeBytes }).from(fileNodes).where(eq(fileNodes.id, input.nodeId))
  if (!node) throw notFound('Document')
  // Callers hold storage → tree → document locks. Charge the resulting state now rather than
  // waiting for compaction, which otherwise allows unlimited growth between worker runs.
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, await mergedDocState(tx, input.nodeId))
    Y.applyUpdate(doc, input.update)
    const sizeBytes = Y.encodeStateAsUpdate(doc).byteLength
    if (sizeBytes > MAX_DOC_STATE_BYTES) throw docTooLarge()
    await assertStorageCapacity(tx, node.ownerUserId, Math.max(0, sizeBytes - node.sizeBytes), { perFileLimit: false })
    // Keep the old charge until compaction actually discards the larger snapshot.
    await tx.update(fileNodes).set({ sizeBytes: Math.max(node.sizeBytes, sizeBytes) }).where(eq(fileNodes.id, input.nodeId))
  } finally {
    doc.destroy()
  }
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
}

export async function scheduleCompactionAfterUpdate(nodeId: string, pendingUpdates: number): Promise<void> {
  if (pendingUpdates === 1) await scheduleDocCompaction(nodeId)
  else if (pendingUpdates % COMPACT_EVERY_UPDATES === 0) await scheduleDocCompaction(nodeId, 0)
}

/** Durably records one Yjs update. Callers broadcast it only after this resolves. */
export async function appendDocUpdate(input: DocUpdateInput): Promise<void> {
  const pending = await db.transaction(async (tx) => {
    const [node] = await tx.select({ ownerUserId: fileNodes.ownerUserId }).from(fileNodes).where(eq(fileNodes.id, input.nodeId))
    if (!node) throw notFound('Document')
    await lockAccountStorage(tx, node.ownerUserId)
    await lockFileTree(tx, node.ownerUserId)
    if (input.ownerUserId) {
      const access = await resolveFileAccess(tx, input.ownerUserId, input.nodeId)
      if (!access || access.node.kind !== 'doc' || access.node.trashedAt || access.node.status !== 'ready') throw notFound('Document')
    }
    return appendDocUpdateInTx(tx, input)
  })
  await scheduleCompactionAfterUpdate(input.nodeId, pending)
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

/** The document's generation (see `DOC_META_MAP`), or null for documents made before them. */
export async function docGeneration(nodeId: string): Promise<string | null> {
  const [doc] = await db.select({ generation: fileDocs.generation }).from(fileDocs).where(eq(fileDocs.nodeId, nodeId))
  return doc?.generation ?? null
}

export async function loadYDoc(nodeId: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, await loadDocUpdate(nodeId))
  return doc
}

/** Worker: folds logged updates into the snapshot, then deletes exactly the rows it folded. */
export async function compactDoc(nodeId: string, now = new Date()): Promise<void> {
  let collectAfter: number | undefined
  const unusedAssets = await db.transaction(async (tx): Promise<string[]> => {
    const [node] = await tx.select({ ownerUserId: fileNodes.ownerUserId, format: fileNodes.format }).from(fileNodes).where(eq(fileNodes.id, nodeId))
    if (!node) return []
    // Tree mutations can lock the node before deleting/converting its document. Match their
    // tree → document → node order so compaction cannot deadlock a rename or subtree purge.
    await lockAccountStorage(tx, node.ownerUserId)
    await lockFileTree(tx, node.ownerUserId)
    const [doc] = await tx.select().from(fileDocs).where(eq(fileDocs.nodeId, nodeId)).for('update')
    if (!doc) return []
    const rows = await tx.select({ seq: fileDocUpdates.seq, update: fileDocUpdates.update }).from(fileDocUpdates)
      .where(eq(fileDocUpdates.nodeId, nodeId)).orderBy(asc(fileDocUpdates.seq))
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, doc.state)
    for (const row of rows) Y.applyUpdate(ydoc, row.update)
    const state = Y.encodeStateAsUpdate(ydoc)
    let markdown = doc.markdown
    try {
      markdown = liveFormatCodec(docFormat(node)).toText(ydoc)
    } catch (error) {
      // The snapshot is still authoritative; stale text only affects previews and search.
      console.error(JSON.stringify({ level: 'error', event: 'file_doc.markdown_failed', nodeId, error: error instanceof Error ? error.message : String(error) }))
    }
    if (rows.length) {
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
    }
    // Parts the document no longer refers to (a mixed-line-break original replaced, say) stop
    // costing storage.
    try {
      const codec = liveFormatCodec(docFormat(node))
      const unused = await collectUnusedAssets(tx, nodeId, codec, ydoc, now)
      if (codec.referencedAssets) {
        const [youngAsset] = await tx.select({ createdAt: fileDocAssets.createdAt }).from(fileDocAssets).where(and(
          eq(fileDocAssets.nodeId, nodeId), gt(fileDocAssets.createdAt, new Date(now.getTime() - ASSET_GRACE_MS)),
        )).orderBy(asc(fileDocAssets.createdAt)).limit(1)
        if (youngAsset) collectAfter = Math.max(1_000, youngAsset.createdAt.getTime() + ASSET_GRACE_MS + 1 - now.getTime())
      }
      return unused
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'file_doc.asset_gc_failed', nodeId, error: error instanceof Error ? error.message : String(error) }))
      return []
    }
  })
  await deleteObjects(unusedAssets)
  if (collectAfter !== undefined) await scheduleDocAssetCollection(nodeId, collectAfter)
}

/** Maintenance safety net for compactions a deduplicated schedule may have skipped. */
export async function scheduleStaleDocCompactions(now = new Date()): Promise<void> {
  const stale = await db.select({ nodeId: fileDocs.nodeId }).from(fileDocs).where(and(
    gt(fileDocs.pendingUpdates, 0),
    lt(fileDocs.lastEditedAt, new Date(now.getTime() - 60_000)),
  )).limit(500)
  for (const doc of stale) await scheduleDocCompaction(doc.nodeId, 0)
}

/**
 * A document's plain text (`codec.toText`): Markdown for Markdown documents, which is what this
 * route has always answered with, and the content of text files.
 */
export async function readDocMarkdown(userId: string, nodeId: string): Promise<{ name: string; markdown: string; format: string }> {
  const access = await resolveFileAccess(db, userId, nodeId)
  if (!access || access.node.kind !== 'doc') throw notFound('Document')
  const format = docFormat(access.node)
  const [doc] = await db.select({ markdown: fileDocs.markdown, pendingUpdates: fileDocs.pendingUpdates })
    .from(fileDocs).where(eq(fileDocs.nodeId, nodeId))
  if (!doc) throw notFound('Document')
  if (!doc.pendingUpdates) return { name: access.node.name, markdown: doc.markdown, format: format.id }
  return { name: access.node.name, markdown: liveFormatCodec(format).toText(await loadYDoc(nodeId)), format: format.id }
}
