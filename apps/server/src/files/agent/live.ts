import type { Readable } from 'node:stream'
import { and, desc, eq, ne } from 'drizzle-orm'
import * as Y from 'yjs'
import { z } from 'zod'
import { liveFormatCodec } from '@pulpo/client-core/office/codecs'
import type { FileAccessMode } from '@pulpo/contracts'
import { fileChanges, fileDocs } from '../../database/schema.js'
import { newId } from '../../lib/ids.js'
import { getBlobStore } from '../../storage/index.js'
import type { FileExecutor, FileNodeRow } from '../access.js'
import { appendDocUpdateInTx } from '../doc-store.js'
import { MAX_DOC_STATE_BYTES } from '../doc-state.js'
import { codecCall, docFormat, exportLiveDoc, exportStoredDoc, loadLiveDocInTx, textOfFile } from '../live-docs.js'
import { setChangeStatus, type ReplyContext } from './changes.js'
import type { CommitEffects, DatabaseTransaction } from './commit.js'
import { contentChecksum, dropVersion, keepVersion, referencesObject } from './versions.js'

/**
 * Agent edits to live documents other than Markdown (Markdown keeps its inline-suggestion path in
 * `docs.ts`). The agent works on real files: `pull` writes the codec's export, and `push` applies
 * a new file through `codec.applyFile`, so users editing meanwhile keep their edits.
 *
 * Change rows keep file versions as exported bytes in the blob store (kept as `file_versions`
 * so they count toward storage and go with the document): Write rows the document before and
 * after the reply, for undo and redo; Suggest rows the document when proposed (`before`) and the
 * whole proposed file (`after`), plus the proposal as a Yjs update against the document as it was
 * then (`updateKey`), so accepting it later merges with what users wrote since.
 */

export const liveSnapshotSchema = z.object({
  format: z.string(),
  objectKey: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string(),
  mimeType: z.string().nullable(),
  updateKey: z.string().optional(),
})
export type LiveSnapshot = z.infer<typeof liveSnapshotSchema>

export function parseLiveSnapshot(value: unknown): LiveSnapshot | null {
  return liveSnapshotSchema.safeParse(value).data ?? null
}

/** Whether a document is edited through this module rather than as Markdown. */
export function isLiveDoc(node: Pick<FileNodeRow, 'kind' | 'format'>): boolean {
  return node.kind === 'doc' && (node.format ?? 'markdown') !== 'markdown'
}

export async function readObject(key: string): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of await getBlobStore().getStream(key) as Readable) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

/** Objects a live change wrote; deleted again if its transaction does not commit. */
export class WrittenObjects {
  readonly keys: string[] = []

  async put(userId: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    const key = `users/${userId}/files/${newId()}`
    this.keys.push(key)
    await getBlobStore().put(key, Buffer.from(bytes), { contentType: mimeType, contentLength: bytes.byteLength })
    return key
  }

  async discard(): Promise<void> {
    for (const key of this.keys) await getBlobStore().delete(key).catch(() => undefined)
  }
}

/** Stores one version of a document as a kept version of it. */
export async function storeLiveSnapshot(tx: DatabaseTransaction, written: WrittenObjects, userId: string, node: FileNodeRow, bytes: Uint8Array): Promise<LiveSnapshot> {
  const snapshot = {
    format: docFormat(node).id,
    objectKey: await written.put(userId, bytes, node.mimeType ?? 'application/octet-stream'),
    sizeBytes: bytes.byteLength,
    checksum: contentChecksum(bytes),
    mimeType: node.mimeType,
  }
  await keepVersion(tx, userId, node.id, snapshot)
  return snapshot
}

/** Objects a snapshot holds. */
export function snapshotKeys(snapshot: LiveSnapshot): string[] {
  return [snapshot.objectKey, ...snapshot.updateKey ? [snapshot.updateKey] : []]
}

/**
 * A snapshot stopped being needed by `row` (its proposal was settled or replaced). Each of its
 * objects stays while another change row still needs it, and is otherwise deleted after commit.
 */
export async function releaseLiveSnapshot(tx: DatabaseTransaction, effects: CommitEffects, snapshot: LiveSnapshot | null): Promise<void> {
  if (!snapshot) return
  for (const key of snapshotKeys(snapshot)) {
    const [needed] = await tx.select({ id: fileChanges.id }).from(fileChanges).where(referencesObject(key)).limit(1)
    if (needed) continue
    await dropVersion(tx, key)
    effects.deletedKeys.push(key)
  }
}

/** This chat's pending proposal of a new version of a live document, if any. */
export async function pendingLiveProposal(executor: FileExecutor, chatId: string, nodeId: string): Promise<{ id: string; responseId: string; before: LiveSnapshot | null; after: LiveSnapshot } | null> {
  const [row] = await executor.select({ id: fileChanges.id, responseId: fileChanges.responseId, before: fileChanges.before, after: fileChanges.after }).from(fileChanges).where(and(
    eq(fileChanges.chatId, chatId),
    eq(fileChanges.nodeId, nodeId),
    eq(fileChanges.kind, 'update'),
    eq(fileChanges.mode, 'suggest'),
    eq(fileChanges.status, 'pending'),
  )).orderBy(desc(fileChanges.seq)).limit(1)
  const after = parseLiveSnapshot(row?.after)
  return row && after ? { id: row.id, responseId: row.responseId, before: parseLiveSnapshot(row.before), after } : null
}

/** What an agent sees of a live document: its chat's pending proposal while it may only suggest changes, else the document. */
export async function agentLiveView(executor: FileExecutor, chatId: string, node: FileNodeRow, mode: () => Promise<FileAccessMode | null>): Promise<{ bytes: Uint8Array; version: string; proposal: boolean }> {
  const proposal = await pendingLiveProposal(executor, chatId, node.id)
  if (proposal && await mode() === 'suggest') return { bytes: await readObject(proposal.after.objectKey), version: proposal.after.checksum, proposal: true }
  const bytes = await exportStoredDoc(node)
  return { bytes, version: contentChecksum(bytes), proposal: false }
}

/** The plain text an agent sees of a live document (for cat and grep). */
export async function agentLiveText(executor: FileExecutor, chatId: string, node: FileNodeRow, mode: () => Promise<FileAccessMode | null>): Promise<string> {
  const proposal = await pendingLiveProposal(executor, chatId, node.id)
  if (proposal && await mode() === 'suggest') return textOfFile(executor, node, await readObject(proposal.after.objectKey))
  const [doc] = await executor.select({ text: fileDocs.markdown, pendingUpdates: fileDocs.pendingUpdates }).from(fileDocs).where(eq(fileDocs.nodeId, node.id))
  if (doc && !doc.pendingUpdates) return doc.text
  const loaded = await executor.transaction(async (tx) => loadLiveDocInTx(tx, node))
  return liveFormatCodec(loaded.format).toText(loaded.doc)
}

/**
 * Applies file bytes to a locked live document as a minimal diff and logs the update, which open
 * editors receive after commit. Returns the document's export afterwards, or null when nothing
 * changed.
 */
export async function applyLiveFileInTx(tx: DatabaseTransaction, effects: CommitEffects, input: {
  node: FileNodeRow
  bytes: Uint8Array
  actorUserId: string
  origin: 'agent' | 'client' | 'restore'
}): Promise<Uint8Array | null> {
  const { doc, format, context } = await loadLiveDocInTx(tx, input.node)
  const vector = Y.encodeStateVector(doc)
  const { changed } = await codecCall(() => liveFormatCodec(format).applyFile(doc, input.bytes, context, input.origin))
  if (!changed) return null
  await context.assets.flush(tx, input.node.ownerUserId, input.node.id)
  await logLiveUpdate(tx, effects, input.node.id, Y.encodeStateAsUpdate(doc, vector), input.actorUserId, input.origin)
  return exportLiveDoc(doc, format, context)
}

export async function logLiveUpdate(tx: DatabaseTransaction, effects: CommitEffects, nodeId: string, update: Uint8Array, actorUserId: string, origin: 'agent' | 'client' | 'restore'): Promise<void> {
  // A whole rewritten document can exceed what one client keystroke batch may send.
  const pendingUpdates = await appendDocUpdateInTx(tx, { nodeId, actorUserId, update, origin, maxBytes: MAX_DOC_STATE_BYTES })
  effects.docUpdates.push({ nodeId, update, pendingUpdates })
}

/**
 * The proposal as a Yjs update against the document as it is now, written on a scratch copy.
 * Returns null when the proposed file reads the same as the document.
 */
export async function proposalUpdate(tx: DatabaseTransaction, node: FileNodeRow, bytes: Uint8Array): Promise<{ update: Uint8Array; current: Uint8Array } | null> {
  const { doc, format, context } = await loadLiveDocInTx(tx, node)
  const current = await exportLiveDoc(doc, format, context)
  const vector = Y.encodeStateVector(doc)
  const { changed } = await codecCall(() => liveFormatCodec(format).applyFile(doc, bytes, context, 'agent'))
  if (!changed) return null
  // Parts the proposal adds are kept with the document now, so accepting it later finds them.
  await context.assets.flush(tx, node.ownerUserId, node.id)
  return { update: Y.encodeStateAsUpdate(doc, vector), current }
}

/**
 * Accepts a proposal: the proposed file itself when the document is still what it was proposed
 * against, and otherwise the proposal's update, which merges with the edits made since.
 */
export async function acceptLiveProposal(tx: DatabaseTransaction, effects: CommitEffects, node: FileNodeRow, userId: string, before: LiveSnapshot | null, after: LiveSnapshot): Promise<void> {
  const { doc, format, context } = await loadLiveDocInTx(tx, node)
  const current = contentChecksum(await exportLiveDoc(doc, format, context))
  if (before && current === before.checksum) {
    await applyLiveFileInTx(tx, effects, { node, bytes: await readObject(after.objectKey), actorUserId: userId, origin: 'agent' })
    return
  }
  if (!after.updateKey) {
    await applyLiveFileInTx(tx, effects, { node, bytes: await readObject(after.objectKey), actorUserId: userId, origin: 'agent' })
    return
  }
  const vector = Y.encodeStateVector(doc)
  Y.applyUpdate(doc, await readObject(after.updateKey), 'agent')
  const update = Y.encodeStateAsUpdate(doc, vector)
  if (update.byteLength > 2) await logLiveUpdate(tx, effects, node.id, update, userId, 'agent')
}

/** A newer proposal for a document replaces this chat's earlier ones from other replies. */
export async function supersedeLiveProposals(tx: DatabaseTransaction, effects: CommitEffects, reply: ReplyContext, nodeId: string): Promise<void> {
  const older = await tx.select().from(fileChanges).where(and(
    eq(fileChanges.chatId, reply.chatId), eq(fileChanges.nodeId, nodeId), eq(fileChanges.kind, 'update'),
    eq(fileChanges.mode, 'suggest'), eq(fileChanges.status, 'pending'), ne(fileChanges.responseId, reply.responseId),
  ))
  await setChangeStatus(tx, older.map((row) => row.id), 'rejected')
  for (const row of older) {
    await releaseLiveSnapshot(tx, effects, parseLiveSnapshot(row.after))
    await releaseLiveSnapshot(tx, effects, parseLiveSnapshot(row.before))
  }
}
