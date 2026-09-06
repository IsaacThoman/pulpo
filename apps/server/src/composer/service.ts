import { redis } from '../redis.js'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, or, sql, lte } from 'drizzle-orm'
import { emptyComposerState, type ComposerAck, type ComposerSnapshot, type ComposerWrite } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, chats, composerDrafts, composerDraftAttachments } from '../database/schema.js'
import { accessibleChatCondition, TEMPORARY_CHAT_TTL_MS } from '../chats/temporary.js'

type DraftRow = typeof composerDrafts.$inferSelect
function snapshot(row: DraftRow): ComposerSnapshot {
  return { draftId: row.draftId, revision: row.revision, clearedRevision: row.clearedRevision, state: row.state, mutationId: row.mutationId }
}

/** Row locking plus revision checks works across API replicas, without trusting client clocks. */
export async function accessComposer(userId: string, draftId: string, write?: ComposerWrite, database: Pick<typeof db, 'transaction'> = db): Promise<ComposerAck> {
  return database.transaction(async (tx) => {
    let chatExpiry: Date | null = null
    if (draftId !== 'new') {
      const [chat] = await tx.select().from(chats).where(and(eq(chats.id, draftId), eq(chats.userId, userId), isNull(chats.deletedAt), accessibleChatCondition())).for('share')
      if (!chat) {
        if (!write) {
          const [cleared] = await tx.select().from(composerDrafts).where(and(eq(composerDrafts.userId, userId), eq(composerDrafts.draftId, draftId)))
          if (cleared && cleared.revision === cleared.clearedRevision) return { ok: true, snapshot: snapshot(cleared) }
        }
        return { ok: false, error: 'chat_unavailable' }
      }
      chatExpiry = chat.expiresAt
    }
    await tx.insert(composerDrafts).values({ id: randomUUID(), userId, draftId, chatId: draftId === 'new' ? null : draftId, modelId: '', editorId: '', revision: 0, state: emptyComposerState() }).onConflictDoNothing()
    let [row] = await tx.select().from(composerDrafts).where(and(eq(composerDrafts.userId, userId), eq(composerDrafts.draftId, draftId))).for('update')
    if (row!.expiresAt && row!.expiresAt <= new Date()) {
      ;[row] = await tx.update(composerDrafts).set({ content: '', state: emptyComposerState(), revision: row!.revision + 1, clearedRevision: row!.revision + 1, mutationId: null, expiresAt: null }).where(and(eq(composerDrafts.userId, userId), eq(composerDrafts.draftId, draftId))).returning()
    }
    if (row!.revision > 0 && row!.revision === row!.clearedRevision) await tx.delete(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, row!.id))
    if (!write || write.mutationId === row!.mutationId) return { ok: true, snapshot: snapshot(row!) }
    if (write.baseRevision !== row!.revision) return { ok: true, conflict: true, snapshot: snapshot(row!) }
    const patch = { ...write.patch }
    if (patch.attachments?.length) {
      const ids = [...new Set(patch.attachments.map((a) => a.id))]
      const owned = await tx.select({ attachment: attachments }).from(attachments).leftJoin(chats, eq(chats.id, attachments.chatId)).where(and(
        inArray(attachments.id, ids), eq(attachments.userId, userId), eq(attachments.status, 'ready'),
        or(isNull(attachments.chatId), and(isNull(chats.deletedAt), accessibleChatCondition())),
      )).for('share', { of: attachments })
      if (owned.length !== ids.length) return { ok: false, error: 'attachment_unavailable' }
      const byId = new Map(owned.map(({ attachment }) => [attachment.id, attachment]))
      patch.attachments = ids.map((id) => {
        const a = byId.get(id)!
        return { id, name: a.originalName, mimeType: a.mimeType, size: a.sizeBytes }
      })
    }
    const revision = row!.revision + 1
    const state = write.clear ? { ...row!.state, content: '', attachments: [] } : { ...row!.state, ...patch }
    const expiresAt = draftId === 'new'
      ? state.temporary ? row!.expiresAt ?? new Date(Date.now() + TEMPORARY_CHAT_TTL_MS) : null
      : chatExpiry
    const [updated] = await tx.update(composerDrafts).set({
      state, content: state.content, modelId: state.model?.id ?? '', presetSelections: state.model?.presets ?? {}, agentMode: state.agentMode, autoExpire: state.autoExpire, revision, clearedRevision: write.clear ? revision : row!.clearedRevision,
      mutationId: write.mutationId, expiresAt: write.clear ? null : expiresAt, updatedAt: new Date(),
    }).where(and(eq(composerDrafts.userId, userId), eq(composerDrafts.draftId, draftId))).returning()
    await tx.delete(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, row!.id))
    if (state.attachments.length) await tx.insert(composerDraftAttachments).values(state.attachments.map((a, position) => ({ draftId: row!.id, attachmentId: a.id, position })))
    return { ok: true, snapshot: snapshot(updated!) }
  })
}

export async function composerAttachmentIsLive(userId: string, id: string, database: Pick<typeof db, 'select'> = db): Promise<boolean> {
  const [row] = await database.select({ draftId: composerDrafts.draftId }).from(composerDrafts).where(and(
    eq(composerDrafts.userId, userId),
    sql`${composerDrafts.state}->'attachments' @> ${JSON.stringify([{ id }])}::jsonb`,
    or(isNull(composerDrafts.expiresAt), sql`${composerDrafts.expiresAt} > now()`),
  )).limit(1)
  return Boolean(row)
}

export async function expireComposerDrafts(): Promise<void> {
  const expired = await db.update(composerDrafts).set({ content: '', state: emptyComposerState(), revision: sql`${composerDrafts.revision} + 1`, clearedRevision: sql`${composerDrafts.revision} + 1`, mutationId: null, expiresAt: null }).where(lte(composerDrafts.expiresAt, new Date())).returning()
  for (const row of expired) {
    await db.delete(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, row.id))
    await redis.publish('pulpo:composer-changes', JSON.stringify({ userId: row.userId, snapshot: snapshot(row) }))
  }
}
