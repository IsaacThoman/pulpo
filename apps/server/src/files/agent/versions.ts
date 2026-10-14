import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { mimeTypeFromName } from '../../attachments/generated.js'
import { canonicalUploadedMimeType } from '../../attachments/policy.js'
import { db } from '../../database/client.js'
import { fileChanges, fileNodes, fileVersions } from '../../database/schema.js'
import { newId } from '../../lib/ids.js'
import { getBlobStore } from '../../storage/index.js'
import type { FileExecutor, FileNodeRow } from '../access.js'
import { lockFileTree } from '../tree-service.js'
import type { CommitEffects, DatabaseTransaction } from './commit.js'

/** One stored content of an uploaded file, as change rows record it. */
export const blobSnapshotSchema = z.object({
  objectKey: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  mimeType: z.string().nullable(),
})
export type BlobSnapshot = z.infer<typeof blobSnapshotSchema>

export function blobSnapshot(node: FileNodeRow): BlobSnapshot {
  return { objectKey: node.objectKey!, sizeBytes: node.sizeBytes, checksum: node.checksum, mimeType: node.mimeType }
}

export function parseBlobSnapshot(value: unknown): BlobSnapshot | null {
  return blobSnapshotSchema.safeParse(value).data ?? null
}

/** The checksum Files keeps for uploaded bytes (see `inspectAttachmentStream`). */
export function contentChecksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

/** The opaque version the agent sees for an uploaded file's content. */
export function blobVersion(snapshot: BlobSnapshot): string {
  // Files stored before checksums were kept still need a token; content changes always get new keys.
  return snapshot.checksum ?? `key-${createHash('sha256').update(snapshot.objectKey).digest('hex')}`
}

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql|log|ini|cfg|conf|env)$/i

/** Whether an uploaded file can be shown and searched as text. */
export function readsAsText(name: string, mimeType: string | null): boolean {
  const mime = mimeType ?? ''
  return mime.startsWith('text/') || /json|xml|yaml|csv|javascript|typescript|markdown/.test(mime) || TEXT_EXTENSIONS.test(name)
}

function blobMimeType(name: string, bytes: Uint8Array, fallback: string | null): string {
  const expected = mimeTypeFromName(name) ?? (TEXT_EXTENSIONS.test(name) ? 'text/plain' : fallback ?? 'application/octet-stream')
  // Image types are believed only when the bytes are that image.
  return canonicalUploadedMimeType(expected, bytes)
}

/**
 * Stores new contents for an uploaded file under a key no node has used, so earlier contents
 * kept as versions are never overwritten. Callers delete the object if they do not commit it.
 */
export async function storeBlob(userId: string, name: string, bytes: Uint8Array, fallbackMimeType: string | null = null): Promise<BlobSnapshot> {
  const snapshot = {
    objectKey: `users/${userId}/files/${newId()}`,
    sizeBytes: bytes.byteLength,
    checksum: contentChecksum(bytes),
    mimeType: blobMimeType(name, bytes, fallbackMimeType),
  }
  await getBlobStore().put(snapshot.objectKey, bytes, { contentType: snapshot.mimeType, contentLength: bytes.byteLength })
  return snapshot
}

/** Makes `content` an uploaded file's current content. */
export async function setBlobContent(tx: DatabaseTransaction, nodeId: string, content: BlobSnapshot): Promise<void> {
  await tx.update(fileNodes).set({ ...content, revision: sql`${fileNodes.revision} + 1`, updatedAt: new Date() }).where(eq(fileNodes.id, nodeId))
}

/** Records a non-current content so it counts toward storage and is deleted with its file. */
export async function keepVersion(tx: DatabaseTransaction, userId: string, nodeId: string, snapshot: BlobSnapshot): Promise<void> {
  await tx.insert(fileVersions).values({ userId, nodeId, ...snapshot }).onConflictDoNothing()
}

/** A kept content became current again: it is charged through its file from now on. */
export async function dropVersion(tx: DatabaseTransaction, objectKey: string): Promise<void> {
  await tx.delete(fileVersions).where(eq(fileVersions.objectKey, objectKey))
}

export async function hasVersion(executor: FileExecutor, objectKey: string): Promise<boolean> {
  const [row] = await executor.select({ key: fileVersions.objectKey }).from(fileVersions).where(eq(fileVersions.objectKey, objectKey)).limit(1)
  return Boolean(row)
}

/**
 * Change rows that still need an object: Write-mode rows keep both sides for undo and redo,
 * and pending suggestions keep what they propose.
 */
function referencesObject(objectKey: string | typeof fileVersions.objectKey) {
  return sql`(
    (${fileChanges.mode} = 'write' and (${fileChanges.before}->>'objectKey' = ${objectKey} or ${fileChanges.after}->>'objectKey' = ${objectKey}))
    or (${fileChanges.status} = 'pending' and ${fileChanges.after}->>'objectKey' = ${objectKey})
  )`
}

/**
 * Called when content stops being current or proposed: it stays as a version while a change
 * row needs it, and is otherwise deleted once the transaction commits. Content that is a
 * file's current content (say, a proposal accepted meanwhile) is never touched.
 */
export async function releaseBlob(tx: DatabaseTransaction, effects: CommitEffects, userId: string, nodeId: string, snapshot: BlobSnapshot): Promise<void> {
  const [current] = await tx.select({ id: fileNodes.id }).from(fileNodes).where(eq(fileNodes.objectKey, snapshot.objectKey)).limit(1)
  if (current) return dropVersion(tx, snapshot.objectKey)
  const [needed] = await tx.select({ id: fileChanges.id }).from(fileChanges)
    .where(and(eq(fileChanges.nodeId, nodeId), referencesObject(snapshot.objectKey))).limit(1)
  if (needed) return keepVersion(tx, userId, nodeId, snapshot)
  await dropVersion(tx, snapshot.objectKey)
  effects.deletedKeys.push(snapshot.objectKey)
}

/** This chat's pending proposal of new content for an uploaded file, if any. */
export async function pendingBlobProposal(executor: FileExecutor, chatId: string, nodeId: string): Promise<{ id: string; responseId: string; after: BlobSnapshot } | null> {
  const [row] = await executor.select({ id: fileChanges.id, responseId: fileChanges.responseId, after: fileChanges.after }).from(fileChanges).where(and(
    eq(fileChanges.chatId, chatId),
    eq(fileChanges.nodeId, nodeId),
    eq(fileChanges.kind, 'update'),
    eq(fileChanges.mode, 'suggest'),
    eq(fileChanges.status, 'pending'),
  )).orderBy(desc(fileChanges.seq)).limit(1)
  const after = parseBlobSnapshot(row?.after)
  return row && after ? { id: row.id, responseId: row.responseId, after } : null
}

/** What an agent in `chatId` sees of an uploaded file: its own pending proposal, else the file. */
export async function agentBlobView(executor: FileExecutor, chatId: string, node: FileNodeRow): Promise<BlobSnapshot> {
  return (await pendingBlobProposal(executor, chatId, node.id))?.after ?? blobSnapshot(node)
}

/** Kept contents no change row needs any more. */
const unusedVersion = sql`not exists (
  select 1 from ${fileChanges} where ${fileChanges.nodeId} = ${fileVersions.nodeId} and ${referencesObject(fileVersions.objectKey)}
)`

/**
 * Maintenance: deletes kept contents nothing needs any more, object first so a failed delete is
 * retried. Runs per account under its Files lock, so no change can claim one meanwhile.
 */
export async function deleteUnusedVersions(limit = 500): Promise<number> {
  const accounts = await db.select({ userId: fileVersions.userId }).from(fileVersions).where(unusedVersion)
    .groupBy(fileVersions.userId).limit(limit)
  let deleted = 0
  for (const { userId } of accounts) {
    // One account's storage failure must not block cleanup for the others.
    deleted += await db.transaction(async (tx) => {
      await lockFileTree(tx, userId)
      const unused = await tx.select({ key: fileVersions.objectKey }).from(fileVersions)
        .where(and(eq(fileVersions.userId, userId), unusedVersion)).limit(limit)
      for (const { key } of unused) {
        await getBlobStore().delete(key)
        await dropVersion(tx, key)
      }
      return unused.length
    }).catch(() => 0)
  }
  return deleted
}
