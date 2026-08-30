import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import {
  attachments,
  composerDraftAttachments,
  composerDrafts,
  queuedMessages,
  responses,
} from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { attachmentReferenceIsLive } from '../attachments/references.js'

export async function cleanupUnreferencedDraftAttachments(userId: string, attachmentIds: string[]): Promise<void> {
  const ids = [...new Set(attachmentIds)]
  if (!ids.length) return
  const [draftRows, responseRows, queueRows, candidates] = await Promise.all([
    db.select({ attachmentId: composerDraftAttachments.attachmentId })
      .from(composerDraftAttachments)
      .innerJoin(composerDrafts, eq(composerDrafts.id, composerDraftAttachments.draftId))
      .where(and(eq(composerDrafts.userId, userId), inArray(composerDraftAttachments.attachmentId, ids))),
    db.select({ input: responses.input }).from(responses).where(and(
      eq(responses.userId, userId),
      isNull(responses.deletedAt),
    )),
    db.select({ attachmentIds: queuedMessages.attachmentIds }).from(queuedMessages).where(eq(queuedMessages.userId, userId)),
    db.select().from(attachments).where(and(
      eq(attachments.userId, userId),
      eq(attachments.origin, 'user'),
      eq(attachments.status, 'ready'),
      inArray(attachments.id, ids),
    )),
  ])
  const draftReferences = new Set(draftRows.map((row) => row.attachmentId))
  for (const attachment of candidates) {
    if (draftReferences.has(attachment.id)) continue
    if (attachmentReferenceIsLive(
      attachment.id,
      responseRows.map((row) => row.input),
      queueRows.map((row) => row.attachmentIds),
    )) continue
    try {
      await getBlobStore().delete(attachment.objectKey)
      await db.update(attachments).set({ status: 'deleted', updatedAt: new Date() }).where(eq(attachments.id, attachment.id))
    } catch {
      // Cleanup is best-effort. A later explicit removal or maintenance pass can retry.
    }
  }
}

export async function deleteAllComposerDrafts(userId: string): Promise<void> {
  const rows = await db.select({ attachmentId: composerDraftAttachments.attachmentId })
    .from(composerDraftAttachments)
    .innerJoin(composerDrafts, eq(composerDrafts.id, composerDraftAttachments.draftId))
    .where(eq(composerDrafts.userId, userId))
  await db.delete(composerDrafts).where(eq(composerDrafts.userId, userId))
  await cleanupUnreferencedDraftAttachments(userId, rows.map((row) => row.attachmentId))
}
