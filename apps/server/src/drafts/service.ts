import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ComposerDraft, ComposerDraftChange, ComposerDraftsCleared } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  attachments,
  composerDraftAttachments,
  composerDrafts,
  queuedMessages,
  responses,
  users,
} from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { attachmentReferenceIsLive } from '../attachments/references.js'
import { redis } from '../redis.js'
import { publishStateChange } from '../responses/events.js'

export async function publishComposerDraftChange(userId: string, change: ComposerDraftChange): Promise<void> {
  await redis.publish('pulpo:composer-drafts', JSON.stringify({ userId, type: 'change', payload: change }))
}

export async function publishComposerDraftsCleared(userId: string, event: ComposerDraftsCleared): Promise<void> {
  await redis.publish('pulpo:composer-drafts', JSON.stringify({ userId, type: 'cleared', payload: event }))
}

type DraftReader = Pick<typeof db, 'select'>

export async function readComposerDraft(
  userId: string,
  scope: string,
  reader: DraftReader = db,
): Promise<ComposerDraft | null> {
  const [draft] = await reader.select().from(composerDrafts).where(and(
    eq(composerDrafts.userId, userId),
    eq(composerDrafts.scope, scope),
  )).limit(1)
  if (!draft) return null
  const rows = await reader.select({ attachment: attachments })
    .from(composerDraftAttachments)
    .innerJoin(attachments, eq(attachments.id, composerDraftAttachments.attachmentId))
    .where(eq(composerDraftAttachments.draftId, draft.id))
    .orderBy(asc(composerDraftAttachments.position))
  return {
    scope: scope === 'new' ? 'new' : scope,
    content: draft.content,
    modelId: draft.modelId,
    presetSelections: draft.presetSelections,
    agentMode: draft.agentMode,
    ...(draft.autoExpire === null ? {} : { autoExpire: draft.autoExpire }),
    editorId: draft.editorId,
    attachments: rows.map(({ attachment }) => ({
      id: attachment.id,
      name: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
    revision: draft.revision,
    updatedAt: draft.updatedAt.toISOString(),
  }
}

export async function cleanupUnreferencedDraftAttachments(userId: string, attachmentIds: string[]): Promise<void> {
  const ids = [...new Set(attachmentIds)]
  if (!ids.length) return
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    // Draft saves lock the same rows. Whichever operation wins determines
    // whether the blob is retained or the later save is rejected as deleted.
    const candidates = await tx.select().from(attachments).where(and(
      eq(attachments.userId, userId),
      eq(attachments.origin, 'user'),
      eq(attachments.status, 'ready'),
      inArray(attachments.id, ids),
    )).orderBy(asc(attachments.id)).for('update')
    if (!candidates.length) return
    const [draftRows, responseRows, queueRows] = await Promise.all([
      tx.select({ attachmentId: composerDraftAttachments.attachmentId })
      .from(composerDraftAttachments)
      .innerJoin(composerDrafts, eq(composerDrafts.id, composerDraftAttachments.draftId))
      .where(and(eq(composerDrafts.userId, userId), inArray(composerDraftAttachments.attachmentId, ids))),
      tx.select({ input: responses.input }).from(responses).where(and(
        eq(responses.userId, userId),
        isNull(responses.deletedAt),
      )),
      tx.select({ attachmentIds: queuedMessages.attachmentIds }).from(queuedMessages)
        .where(eq(queuedMessages.userId, userId)),
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
        await tx.update(attachments).set({ status: 'deleted', updatedAt: new Date() })
          .where(eq(attachments.id, attachment.id))
      } catch {
        // Cleanup is best-effort. A later explicit removal or maintenance pass can retry.
      }
    }
  })
}

export async function deleteComposerDraft(input: {
  userId: string
  scope: string
  editorId: string
  reason?: ComposerDraftChange['reason']
}): Promise<number | null> {
  let attachmentIds: string[] = []
  const revision = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`)
    const [draft] = await tx.select({ id: composerDrafts.id }).from(composerDrafts).where(and(
      eq(composerDrafts.userId, input.userId),
      eq(composerDrafts.scope, input.scope),
    )).limit(1)
    if (!draft) return null
    attachmentIds = (await tx.select({ attachmentId: composerDraftAttachments.attachmentId })
      .from(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, draft.id)))
      .map((row) => row.attachmentId)
    const [updated] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
      .where(eq(users.id, input.userId)).returning({ revision: users.stateRevision })
    await tx.delete(composerDrafts).where(eq(composerDrafts.id, draft.id))
    return updated?.revision ?? null
  })
  if (revision === null) return null
  await Promise.all([
    publishComposerDraftChange(input.userId, {
      scope: input.scope === 'new' ? 'new' : input.scope,
      revision,
      editorId: input.editorId,
      draft: null,
      reason: input.reason ?? 'deleted',
    }),
    publishStateChange({ userId: input.userId, revision, scopes: ['drafts'] }),
  ])
  await cleanupUnreferencedDraftAttachments(input.userId, attachmentIds)
  return revision
}

export async function deleteComposerDraftsForChats(
  userId: string,
  chatIds: string[],
  reason: 'chat_deleted' | 'chat_expired',
): Promise<number | null> {
  const uniqueChatIds = [...new Set(chatIds)]
  if (!uniqueChatIds.length) return null
  let removed: Array<{ id: string; scope: string }> = []
  let attachmentIds: string[] = []
  const revision = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    removed = await tx.select({ id: composerDrafts.id, scope: composerDrafts.scope })
      .from(composerDrafts).where(and(
        eq(composerDrafts.userId, userId),
        inArray(composerDrafts.chatId, uniqueChatIds),
      ))
    if (!removed.length) return null
    attachmentIds = (await tx.select({ attachmentId: composerDraftAttachments.attachmentId })
      .from(composerDraftAttachments)
      .where(inArray(composerDraftAttachments.draftId, removed.map((draft) => draft.id))))
      .map((row) => row.attachmentId)
    const [updated] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
      .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
    await tx.delete(composerDrafts).where(inArray(composerDrafts.id, removed.map((draft) => draft.id)))
    return updated?.revision ?? null
  })
  if (revision === null) return null
  const editorId = 'server:chat-lifecycle'
  await Promise.all([
    ...removed.map((draft) => publishComposerDraftChange(userId, {
      scope: draft.scope,
      revision,
      editorId,
      draft: null,
      reason,
    })),
    publishStateChange({ userId, revision, scopes: ['drafts'] }),
  ])
  await cleanupUnreferencedDraftAttachments(userId, attachmentIds)
  return revision
}

export async function deleteAllComposerDrafts(
  userId: string,
  revision: number,
  editorId = 'server:settings',
): Promise<void> {
  let rows: Array<{ attachmentId: string }> = []
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    rows = await tx.select({ attachmentId: composerDraftAttachments.attachmentId })
      .from(composerDraftAttachments)
      .innerJoin(composerDrafts, eq(composerDrafts.id, composerDraftAttachments.draftId))
      .where(eq(composerDrafts.userId, userId))
    await tx.delete(composerDrafts).where(eq(composerDrafts.userId, userId))
  })
  // A bulk clear intentionally does not emit per-scope tombstones: clients
  // detach their server references while retaining each available local draft.
  await publishComposerDraftsCleared(userId, { revision, editorId, reason: 'sync_disabled' })
  await cleanupUnreferencedDraftAttachments(userId, rows.map((row) => row.attachmentId))
}
