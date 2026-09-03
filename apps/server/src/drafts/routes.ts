import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  composerDraftDeleteInputSchema,
  composerDraftInputSchema,
  composerDraftScopeSchema,
  type ComposerDraft,
} from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import {
  attachments,
  chats,
  composerDraftAttachments,
  composerDrafts,
  models,
  userPreferences,
  users,
} from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import {
  cleanupUnreferencedDraftAttachments,
  deleteComposerDraft,
  publishComposerDraftChange,
  readComposerDraft,
} from './service.js'
import { resolveResponseGeneration } from '../responses/service.js'
import { accessibleChatCondition } from '../chats/temporary.js'

export function draftSyncEnabled(values: unknown): boolean {
  return !(values && typeof values === 'object' && 'syncDrafts' in values && values.syncDrafts === false)
}

export function parseComposerDraftScope(raw: string): { scope: string; chatId: string | null } {
  if (raw === 'new') return { scope: raw, chatId: null }
  const parsed = composerDraftScopeSchema.safeParse(raw)
  if (!parsed.success || parsed.data === 'new') {
    throw new AppError(400, 'invalid_draft_scope', 'Choose a valid draft scope')
  }
  return { scope: parsed.data, chatId: parsed.data }
}

type DraftRouteReader = Pick<typeof db, 'select'>

async function assertDraftChat(userId: string, chatId: string | null, reader: DraftRouteReader = db): Promise<void> {
  if (!chatId) return
  const [chat] = await reader.select({ id: chats.id }).from(chats).where(and(
    eq(chats.id, chatId),
    eq(chats.userId, userId),
    eq(chats.temporary, false),
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
    accessibleChatCondition(),
  )).for('share').limit(1)
  if (!chat) throw notFound('Chat')
}

export async function registerComposerDraftRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/composer-drafts/:scope', async (request) => {
    const user = requireUser(request)
    const { scope, chatId } = parseComposerDraftScope((request.params as { scope: string }).scope)
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`)
      await assertDraftChat(user.id, chatId, tx)
      const [preferences] = await tx.select({ values: userPreferences.values }).from(userPreferences)
        .where(eq(userPreferences.userId, user.id)).limit(1)
      const [account] = await tx.select({ revision: users.stateRevision }).from(users)
        .where(eq(users.id, user.id)).limit(1)
      if (!draftSyncEnabled(preferences?.values)) {
        return { draft: null, revision: account?.revision ?? user.stateRevision }
      }
      const draft = await readComposerDraft(user.id, scope, tx)
      return { draft, revision: Math.max(account?.revision ?? user.stateRevision, draft?.revision ?? 0) }
    }, { isolationLevel: 'repeatable read' })
  })

  app.put('/api/composer-drafts/:scope', async (request) => {
    const user = requireUser(request)
    const { scope, chatId } = parseComposerDraftScope((request.params as { scope: string }).scope)
    const input = composerDraftInputSchema.parse(request.body)
    if (chatId && input.autoExpire !== undefined) {
      throw new AppError(400, 'invalid_draft_expiration', 'Only a new-chat draft may choose automatic expiration')
    }
    await assertDraftChat(user.id, chatId)
    const resolvedGeneration = await resolveResponseGeneration(input.modelId, input.presetSelections)
    const [effectiveModel] = await db.select({ agentEnabled: models.agentEnabled }).from(models)
      .where(and(eq(models.id, resolvedGeneration.effectiveModelId), eq(models.enabled, true))).limit(1)
    if (!effectiveModel) throw new AppError(400, 'model_not_found', 'The selected model is unavailable')
    if (input.agentMode && !effectiveModel.agentEnabled) {
      throw new AppError(400, 'model_not_agent_capable', 'The selected model is not enabled for agent mode')
    }
    const presetSelections = resolvedGeneration.selections
    const [preferences] = await db.select({ values: userPreferences.values }).from(userPreferences)
      .where(eq(userPreferences.userId, user.id)).limit(1)
    if (!draftSyncEnabled(preferences?.values)) throw new AppError(409, 'draft_sync_disabled', 'Draft sync is disabled')

    let owned: Array<typeof attachments.$inferSelect> = []
    let removedAttachmentIds: string[] = []
    let canonical: ComposerDraft | null = null
    await db.transaction(async (tx) => {
      // Serialize cloud draft writes with this account's sync-setting changes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`)
      await assertDraftChat(user.id, chatId, tx)
      const [lockedPreferences] = await tx.select({ values: userPreferences.values }).from(userPreferences)
        .where(eq(userPreferences.userId, user.id)).limit(1)
      if (!draftSyncEnabled(lockedPreferences?.values)) {
        throw new AppError(409, 'draft_sync_disabled', 'Draft sync is disabled')
      }
      owned = input.attachmentIds.length ? await tx.select().from(attachments).where(and(
        eq(attachments.userId, user.id),
        eq(attachments.status, 'ready'),
        inArray(attachments.id, input.attachmentIds),
        chatId ? or(isNull(attachments.chatId), eq(attachments.chatId, chatId)) : isNull(attachments.chatId),
      )).orderBy(asc(attachments.id)).for('update') : []
      if (owned.length !== input.attachmentIds.length) {
        throw new AppError(400, 'attachment_not_ready', 'One or more draft attachments are unavailable')
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
      const [revisionRow] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
        .where(eq(users.id, user.id)).returning({ revision: users.stateRevision })
      const revision = revisionRow?.revision
      if (!revision) throw new AppError(500, 'draft_revision_failed', 'Unable to allocate a draft revision')
      const draftId = existing?.id ?? newId()
      const now = new Date()
      const [saved] = await tx.insert(composerDrafts).values({
        id: draftId,
        userId: user.id,
        chatId,
        scope,
        content: input.content,
        modelId: input.modelId,
        presetSelections,
        agentMode: input.agentMode,
        autoExpire: chatId ? null : input.autoExpire ?? false,
        editorId: input.editorId,
        revision,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [composerDrafts.userId, composerDrafts.scope],
        set: {
          content: input.content,
          modelId: input.modelId,
          presetSelections,
          agentMode: input.agentMode,
          autoExpire: chatId ? null : input.autoExpire ?? false,
          editorId: input.editorId,
          revision,
          updatedAt: now,
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
      const attachmentsById = new Map(owned.map((attachment) => [attachment.id, attachment]))
      canonical = {
        scope: scope === 'new' ? 'new' : scope,
        content: input.content,
        modelId: input.modelId,
        presetSelections,
        agentMode: input.agentMode,
        ...(chatId ? {} : { autoExpire: input.autoExpire ?? false }),
        editorId: input.editorId,
        attachments: input.attachmentIds.map((attachmentId) => {
          const attachment = attachmentsById.get(attachmentId)!
          return {
            id: attachment.id,
            name: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          }
        }),
        revision,
        updatedAt: now.toISOString(),
      }
    })
    const persistedDraft = canonical as ComposerDraft | null
    if (!persistedDraft) throw new AppError(500, 'draft_save_failed', 'Unable to save the draft')
    await Promise.all([
      publishComposerDraftChange(user.id, {
        scope: persistedDraft.scope,
        revision: persistedDraft.revision,
        editorId: input.editorId,
        draft: persistedDraft,
        reason: 'saved',
      }),
      publishStateChange({ userId: user.id, revision: persistedDraft.revision, scopes: ['drafts'] }),
    ])
    await cleanupUnreferencedDraftAttachments(user.id, removedAttachmentIds)
    return { draft: persistedDraft }
  })

  app.delete('/api/composer-drafts/:scope', async (request) => {
    const user = requireUser(request)
    const { scope, chatId } = parseComposerDraftScope((request.params as { scope: string }).scope)
    const input = composerDraftDeleteInputSchema.parse(request.body)
    await assertDraftChat(user.id, chatId)
    const deletedRevision = await deleteComposerDraft({ userId: user.id, scope, editorId: input.editorId })
    if (deletedRevision !== null) return { revision: deletedRevision }
    const [account] = await db.select({ revision: users.stateRevision }).from(users).where(eq(users.id, user.id)).limit(1)
    return { revision: account?.revision ?? user.stateRevision }
  })
}
