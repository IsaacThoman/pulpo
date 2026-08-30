import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { composerDraftInputSchema, type ComposerDraft } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import {
  attachments,
  chats,
  composerDraftAttachments,
  composerDrafts,
  userPreferences,
  users,
} from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import { cleanupUnreferencedDraftAttachments } from './service.js'

export function draftSyncEnabled(values: unknown): boolean {
  return !(values && typeof values === 'object' && 'syncDrafts' in values && values.syncDrafts === false)
}

export function parseComposerDraftScope(raw: string): { scope: string; chatId: string | null } {
  if (raw === 'new') return { scope: raw, chatId: null }
  const parsed = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
  if (!parsed) throw new AppError(400, 'invalid_draft_scope', 'Choose a valid draft scope')
  return { scope: raw, chatId: raw }
}

async function assertDraftChat(userId: string, chatId: string | null): Promise<void> {
  if (!chatId) return
  const [chat] = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.id, chatId),
    eq(chats.userId, userId),
    eq(chats.temporary, false),
    isNull(chats.deletedAt),
  )).limit(1)
  if (!chat) throw notFound('Chat')
}

async function readDraft(userId: string, scope: string): Promise<ComposerDraft | null> {
  const [draft] = await db.select().from(composerDrafts).where(and(
    eq(composerDrafts.userId, userId),
    eq(composerDrafts.scope, scope),
  )).limit(1)
  if (!draft) return null
  const rows = await db.select({ attachment: attachments })
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

export async function registerComposerDraftRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/composer-drafts/:scope', async (request) => {
    const user = requireUser(request)
    const { scope, chatId } = parseComposerDraftScope((request.params as { scope: string }).scope)
    const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, user.id)).limit(1)
    if (!draftSyncEnabled(preferences?.values)) return { draft: null }
    await assertDraftChat(user.id, chatId)
    return { draft: await readDraft(user.id, scope) }
  })

  app.put('/api/composer-drafts/:scope', async (request) => {
    const user = requireUser(request)
    const { scope, chatId } = parseComposerDraftScope((request.params as { scope: string }).scope)
    const input = composerDraftInputSchema.parse(request.body)
    if (chatId && input.autoExpire !== undefined) {
      throw new AppError(400, 'invalid_draft_expiration', 'Only a new-chat draft may choose automatic expiration')
    }
    await assertDraftChat(user.id, chatId)
    const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, user.id)).limit(1)
    if (!draftSyncEnabled(preferences?.values)) throw new AppError(409, 'draft_sync_disabled', 'Draft sync is disabled')

    const owned = input.attachmentIds.length ? await db.select().from(attachments).where(and(
      eq(attachments.userId, user.id),
      eq(attachments.status, 'ready'),
      inArray(attachments.id, input.attachmentIds),
      chatId ? or(isNull(attachments.chatId), eq(attachments.chatId, chatId)) : isNull(attachments.chatId),
    )) : []
    if (owned.length !== input.attachmentIds.length) {
      throw new AppError(400, 'attachment_not_ready', 'One or more draft attachments are unavailable')
    }

    let removedAttachmentIds: string[] = []
    let stateRevision = 0
    await db.transaction(async (tx) => {
      // Serialize cloud draft writes with this account's sync-setting changes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`)
      const [lockedPreferences] = await tx.select({ values: userPreferences.values }).from(userPreferences)
        .where(eq(userPreferences.userId, user.id)).limit(1)
      if (!draftSyncEnabled(lockedPreferences?.values)) {
        throw new AppError(409, 'draft_sync_disabled', 'Draft sync is disabled')
      }
      const [existing] = await tx.select().from(composerDrafts).where(and(
        eq(composerDrafts.userId, user.id),
        eq(composerDrafts.scope, scope),
      )).limit(1)
      if (existing) {
        removedAttachmentIds = (await tx.select({ attachmentId: composerDraftAttachments.attachmentId })
          .from(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, existing.id)))
          .map((row) => row.attachmentId).filter((id) => !input.attachmentIds.includes(id))
      }
      const draftId = existing?.id ?? newId()
      const [saved] = await tx.insert(composerDrafts).values({
        id: draftId,
        userId: user.id,
        chatId,
        scope,
        content: input.content,
        modelId: input.modelId,
        presetSelections: input.presetSelections,
        agentMode: input.agentMode,
        autoExpire: chatId ? null : input.autoExpire ?? false,
        editorId: input.editorId,
      }).onConflictDoUpdate({
        target: [composerDrafts.userId, composerDrafts.scope],
        set: {
          content: input.content,
          modelId: input.modelId,
          presetSelections: input.presetSelections,
          agentMode: input.agentMode,
          autoExpire: chatId ? null : input.autoExpire ?? false,
          editorId: input.editorId,
          revision: sql`${composerDrafts.revision} + 1`,
          updatedAt: new Date(),
        },
      }).returning({ id: composerDrafts.id })
      const currentId = saved?.id ?? draftId
      await tx.delete(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, currentId))
      if (input.attachmentIds.length) {
        await tx.insert(composerDraftAttachments).values(input.attachmentIds.map((attachmentId, position) => ({
          draftId: currentId,
          attachmentId,
          position,
        })))
      }
      const [revision] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
        .where(eq(users.id, user.id)).returning({ revision: users.stateRevision })
      stateRevision = revision?.revision ?? 0
    })
    await publishStateChange({ userId: user.id, revision: stateRevision, scopes: ['drafts'] })
    await cleanupUnreferencedDraftAttachments(user.id, removedAttachmentIds)
    return { draft: await readDraft(user.id, scope) }
  })

  app.delete('/api/composer-drafts/:scope', async (request, reply) => {
    const user = requireUser(request)
    const { scope } = parseComposerDraftScope((request.params as { scope: string }).scope)
    const [draft] = await db.select({ id: composerDrafts.id }).from(composerDrafts).where(and(
      eq(composerDrafts.userId, user.id),
      eq(composerDrafts.scope, scope),
    )).limit(1)
    if (!draft) return reply.code(204).send()
    const attachmentIds = (await db.select({ attachmentId: composerDraftAttachments.attachmentId })
      .from(composerDraftAttachments).where(eq(composerDraftAttachments.draftId, draft.id))).map((row) => row.attachmentId)
    const [revision] = await db.transaction(async (tx) => {
      await tx.delete(composerDrafts).where(eq(composerDrafts.id, draft.id))
      return tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
        .where(eq(users.id, user.id)).returning({ revision: users.stateRevision })
    })
    await publishStateChange({ userId: user.id, revision: revision?.revision ?? 0, scopes: ['drafts'] })
    await cleanupUnreferencedDraftAttachments(user.id, attachmentIds)
    return reply.code(204).send()
  })
}
