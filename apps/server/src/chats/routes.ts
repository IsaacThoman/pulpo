import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createChatResponseSchema, createChatSchema, createQueuedMessageSchema, reorderQueuedMessageSchema, startChatSchema, updateChatSchema, updateQueuedMessageSchema, type ChatSearchResult } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { attachments, chatImportSources, chats, folders, models, queuedMessages, requestLogs, responses, users, workspaceLeases } from '../database/schema.js'
import { requireUser } from '../auth/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { createResponse, toSnapshot } from '../responses/service.js'
import { publishStateChange, requestCancellation } from '../responses/events.js'
import { publishAdminUsage } from '../admin/usage-events.js'
import { maintenanceQueue } from '../jobs.js'
import { cancelChatWork, getTrashRetention, markChatsForPurge, purgeAtFor } from './trash.js'
import { planDuplicateTree } from './duplicate.js'
import { toPublicChat, toPublicChatResponses } from './public.js'
import { responseAttachmentIds } from '../messages/input.js'
import {
  accessibleChatCondition,
  scheduleTemporaryChatExpiry,
  temporaryChatExpiresAt,
  temporaryChatIsExpired,
} from './temporary.js'
import { advanceMessageQueue, createQueuedMessage, deleteQueuedMessage, listQueuedMessages, reorderQueuedMessage, updateQueuedMessage } from './message-queue.js'
import { automaticChatExpiresAt, getAutomaticChatExpiration, normalChatIsExpired, scheduleNormalChatExpiry } from './expiration.js'
import { workspaceContinueWithoutAgentIsAvailable } from '../agent/capacity.js'
import { chatSearchTextSnippet, chatSearchTsQuery } from './search.js'

async function requestedNormalChatExpiry(userId: string, enabled: boolean, now: Date): Promise<Date | null> {
  if (!enabled) return null
  const expiresAt = automaticChatExpiresAt(await getAutomaticChatExpiration(userId), now)
  if (!expiresAt) {
    throw new AppError(400, 'automatic_chat_expiration_disabled', 'Choose an automatic chat expiration period in Data controls')
  }
  return expiresAt
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  const bumpRevision = async (userId: string, chatId?: string) => {
    const [updated] = await db.update(users)
      .set({ stateRevision: sql`${users.stateRevision} + 1` })
      .where(eq(users.id, userId))
      .returning({ revision: users.stateRevision })
    if (updated) await publishStateChange({ userId, revision: updated.revision, chatId })
  }

  app.get('/api/chats', async (request) => {
    const user = requireUser(request)
    const rows = await db
      .select()
      .from(chats)
      .where(and(
        eq(chats.userId, user.id), isNull(chats.deletedAt), eq(chats.temporary, false), accessibleChatCondition(),
      ))
      .orderBy(desc(chats.updatedAt))
    const inFlight = rows.length
      ? await db.select({ id: responses.id, chatId: responses.chatId })
        .from(responses)
        .where(and(
          eq(responses.userId, user.id),
          inArray(responses.chatId, rows.map((chat) => chat.id)),
          inArray(responses.status, ['queued', 'in_progress']),
        ))
      : []
    const responseIdsByChat = new Map<string, string[]>()
    for (const response of inFlight) {
      const ids = responseIdsByChat.get(response.chatId)
      if (ids) ids.push(response.id)
      else responseIdsByChat.set(response.chatId, [response.id])
    }
    return {
      data: rows.map((chat) => ({
        ...chat,
        inFlightResponseIds: responseIdsByChat.get(chat.id) ?? [],
      })),
    }
  })

  app.get('/api/chats/deleted', async (request) => {
    const user = requireUser(request)
    const retention = await getTrashRetention(user.id)
    const rows = await db.select({
      id: chats.id,
      title: chats.title,
      modelId: chats.modelId,
      deletedAt: chats.deletedAt,
    }).from(chats).where(and(
      eq(chats.userId, user.id),
      isNotNull(chats.deletedAt),
      isNull(chats.purgeStartedAt),
      eq(chats.temporary, false),
    )).orderBy(desc(chats.deletedAt))
    return {
      data: rows.map((row) => ({
        ...row,
        purgeAt: row.deletedAt ? purgeAtFor(row.deletedAt, retention) : null,
      })),
    }
  })

  app.get('/api/chats/search', async (request) => {
    const user = requireUser(request)
    const query = String((request.query as { q?: string }).q ?? '').trim().slice(0, 200)
    const searchQuery = chatSearchTsQuery(query)
    if (!searchQuery) return { data: [] }
    const result = await db.execute<{
      chatId: string
      title: string
      modelId: string
      updatedAt: Date | string
      matchedOn: 'title' | 'message'
      score: number
      body: string
    }>(sql`
      with search_query as (
        select to_tsquery('simple', ${searchQuery}) as value
      )
      select c.id as "chatId", c.title, c.model_id as "modelId", c.updated_at as "updatedAt",
        case when to_tsvector('simple', coalesce(d.title, '')) @@ q.value then 'title' else 'message' end as "matchedOn",
        ts_rank_cd(
          setweight(to_tsvector('simple', coalesce(d.title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(d.body, '')), 'B'),
          q.value
        ) as score,
        d.body
      from chat_search_documents d
      join chats c on c.id = d.chat_id
      cross join search_query q
      where c.user_id = ${user.id} and c.deleted_at is null and c.temporary = false
        and (c.expires_at is null or c.expires_at > now())
        and (
          setweight(to_tsvector('simple', coalesce(d.title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(d.body, '')), 'B')
        ) @@ q.value
      order by score desc, c.updated_at desc
      limit 50
    `)
    return { data: [...result].map((row): ChatSearchResult => ({
      chatId: row.chatId,
      title: row.title,
      modelId: row.modelId,
      updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
      matchedOn: row.matchedOn,
      snippet: row.matchedOn === 'message' ? chatSearchTextSnippet(row.body, query) : null,
      score: Number(row.score),
    })) }
  })

  app.get('/api/chats/export', async (request, reply) => {
    const user = requireUser(request)
    const chatRows = await db.select().from(chats).where(and(eq(chats.userId, user.id), eq(chats.temporary, false)))
    const responseRows = chatRows.length
      ? await db.select().from(responses).where(and(
        eq(responses.userId, user.id),
        inArray(responses.chatId, chatRows.map((chat) => chat.id)),
      ))
      : []
    return reply.type('application/json').header('content-disposition', 'attachment; filename="pulpo-chats.json"')
      .send({ format: 'pulpo-chat-export', version: 2, exportedAt: new Date().toISOString(), chats: chatRows, responses: responseRows })
  })

  app.post('/api/chats/import', async (request) => {
    const user = requireUser(request)
    const body = request.body as { source?: 'pulpo' | 'openwebui'; data?: unknown; fallbackModelId?: string }
    if (!body.data || !['pulpo', 'openwebui'].includes(body.source ?? '')) throw new AppError(400, 'invalid_import', 'Choose a valid chat export')
    const enabled = await db.select({ id: models.id }).from(models).where(eq(models.enabled, true))
    const enabledIds = new Set(enabled.map((model) => model.id))
    if (body.fallbackModelId && !enabledIds.has(body.fallbackModelId)) throw new AppError(400, 'fallback_model_unavailable', 'The selected fallback model is unavailable')
    const rawChats = body.source === 'openwebui'
      ? (Array.isArray(body.data) ? body.data : Array.isArray((body.data as { chats?: unknown[] }).chats) ? (body.data as { chats: unknown[] }).chats : [body.data])
      : (body.data as { chats?: unknown[] }).chats
    if (!Array.isArray(rawChats) || rawChats.length > 5_000) throw new AppError(400, 'import_limit', 'The import must contain at most 5,000 chats')
    const warnings: string[] = []
    let imported = 0; let duplicates = 0
    await db.transaction(async (tx) => {
      for (const raw of rawChats) {
        const wrapped = raw as Record<string, unknown>
        const chatValue = (wrapped.chat && typeof wrapped.chat === 'object' ? wrapped.chat : wrapped) as Record<string, unknown>
        const sourceChatId = String(wrapped.id ?? chatValue.id ?? '') || createHash('sha256').update(JSON.stringify(chatValue)).digest('hex')
        const fingerprint = createHash('sha256').update(JSON.stringify(chatValue)).digest('hex')
        const [existing] = await tx.select().from(chatImportSources).where(and(eq(chatImportSources.userId, user.id), eq(chatImportSources.source, body.source!), eq(chatImportSources.sourceChatId, sourceChatId))).limit(1)
        if (existing) { duplicates += 1; continue }
        const chatId = newId()
        if (body.source === 'openwebui') {
          const history = (chatValue.history ?? {}) as { messages?: Record<string, Record<string, unknown>>; currentId?: string }
          const messages = history.messages ?? {}
          if (Object.keys(messages).length > 50_000) throw new AppError(400, 'import_limit', 'A chat may contain at most 50,000 messages')
          const sourceModels = new Set(Object.values(messages).map((message) => typeof message.model === 'string' ? message.model : null).filter(Boolean) as string[])
          const unavailable = [...sourceModels].filter((id) => !enabledIds.has(id))
          if (unavailable.length && !body.fallbackModelId) throw new AppError(400, 'fallback_model_required', `Choose a fallback model for: ${unavailable.join(', ')}`)
          const defaultModel = [...sourceModels].find((id) => enabledIds.has(id)) ?? body.fallbackModelId ?? enabled[0]?.id
          if (!defaultModel) throw new AppError(400, 'model_unavailable', 'No enabled Pulpo model is available')
          const createdAt = new Date(Number(wrapped.created_at ?? chatValue.created_at ?? Date.now() / 1000) * 1000)
          await tx.insert(chats).values({ id: chatId, userId: user.id, title: String(chatValue.title ?? 'Imported chat').slice(0, 200), modelId: defaultModel, pinned: Boolean(wrapped.pinned), createdAt, updatedAt: new Date(Number(wrapped.updated_at ?? chatValue.updated_at ?? Date.now() / 1000) * 1000) })
          const responseByAssistant = new Map<string, string>()
          const userVariantIds = new Map<string, string>()
          const assistantMessages = Object.values(messages).filter((message) => message.role === 'assistant').sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0))
          for (const message of assistantMessages) {
            const sourceId = String(message.id ?? '')
            const responseId = newId()
            let parentSource = typeof message.parentId === 'string' ? message.parentId : null
            let userMessage: Record<string, unknown> | undefined
            let sourceUserMessageId: string | null = null
            while (parentSource) {
              const parent = messages[parentSource]
              if (!parent) break
              if (!userMessage && parent.role === 'user') { userMessage = parent; sourceUserMessageId = parentSource }
              if (parent.role === 'assistant' && responseByAssistant.has(parentSource)) break
              parentSource = typeof parent.parentId === 'string' ? parent.parentId : null
            }
            const parentResponseId = parentSource ? responseByAssistant.get(parentSource) ?? null : null
            const modelId = typeof message.model === 'string' && enabledIds.has(message.model) ? message.model : body.fallbackModelId ?? defaultModel
            const userMessageId = sourceUserMessageId ? userVariantIds.get(sourceUserMessageId) ?? newId() : newId()
            if (sourceUserMessageId) userVariantIds.set(sourceUserMessageId, userMessageId)
            const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
            const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : typeof message.reasoning === 'string' ? message.reasoning : ''
            await tx.insert(responses).values({ id: responseId, chatId, userId: user.id, modelId, actualModelId: modelId, parentResponseId, previousResponseId: parentResponseId, userMessageId, branchReason: 'message', status: message.done === false ? 'incomplete' : 'completed', input: [{ role: 'user', content: String(userMessage?.content ?? '') }], output: [...(reasoning ? [{ type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: reasoning }] }] : []), { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }], createdAt: new Date(Number(message.timestamp ?? Date.now() / 1000) * 1000), completedAt: new Date(Number(message.timestamp ?? Date.now() / 1000) * 1000) })
            responseByAssistant.set(sourceId, responseId)
          }
          const active = history.currentId ? responseByAssistant.get(history.currentId) : [...responseByAssistant.values()].at(-1)
          if (active) await tx.update(chats).set({ activeResponseId: active, activeBranchLeafId: active }).where(eq(chats.id, chatId))
          const fileCount = Object.values(messages).reduce((count, message) => count + (Array.isArray(message.files) ? message.files.length : 0), 0)
          if (fileCount) warnings.push(`${String(chatValue.title ?? 'Chat')}: skipped ${fileCount} unavailable OpenWebUI file reference(s)`)
        } else {
          const source = chatValue
          const allResponses = (body.data as { responses?: Array<Record<string, unknown>> }).responses ?? []
          const sourceIdValue = String(source.id ?? '')
          const sourceResponses = allResponses.filter((response) => String(response.chatId ?? response.chat_id ?? '') === sourceIdValue)
          const sourceModel = String(source.modelId ?? source.model_id ?? '')
          const modelId = enabledIds.has(sourceModel) ? sourceModel : body.fallbackModelId
          if (!modelId) throw new AppError(400, 'fallback_model_required', `Choose a fallback model for ${sourceModel || 'an unknown model'}`)
          await tx.insert(chats).values({ id: chatId, userId: user.id, title: String(source.title ?? 'Imported chat').slice(0, 200), modelId, pinned: Boolean(source.pinned), createdAt: source.createdAt ? new Date(String(source.createdAt)) : new Date(), updatedAt: source.updatedAt ? new Date(String(source.updatedAt)) : new Date() })
          const ids = new Map(sourceResponses.map((response) => [String(response.id), newId()]))
          const userVariantIds = new Map<string, string>()
          for (const response of sourceResponses) {
            const sourceResponseModel = String(response.modelId ?? response.model_id ?? modelId)
            const responseModel = enabledIds.has(sourceResponseModel) ? sourceResponseModel : modelId
            const sourceUserMessageId = String(response.userMessageId ?? response.user_message_id ?? response.id)
            const userMessageId = userVariantIds.get(sourceUserMessageId) ?? newId(); userVariantIds.set(sourceUserMessageId, userMessageId)
            await tx.insert(responses).values({ id: ids.get(String(response.id))!, chatId, userId: user.id, modelId: responseModel, actualModelId: responseModel, parentResponseId: ids.get(String(response.parentResponseId ?? response.parent_response_id ?? '')) ?? null, previousResponseId: ids.get(String(response.previousResponseId ?? response.previous_response_id ?? '')) ?? null, userMessageId, branchReason: String(response.branchReason ?? response.branch_reason ?? 'message'), status: (['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'].includes(String(response.status)) ? response.status : 'completed') as typeof responses.$inferInsert.status, input: response.input ?? [], output: response.output ?? [], usage: response.usage, error: response.error, createdAt: response.createdAt ? new Date(String(response.createdAt)) : new Date(), completedAt: response.completedAt ? new Date(String(response.completedAt)) : null })
          }
          const active = ids.get(String(source.activeResponseId ?? source.active_response_id ?? '')) ?? [...ids.values()].at(-1)
          if (active) await tx.update(chats).set({ activeResponseId: active, activeBranchLeafId: active }).where(eq(chats.id, chatId))
        }
        await tx.insert(chatImportSources).values({ userId: user.id, source: body.source!, sourceChatId, chatId, fingerprint })
        imported += 1
      }
    })
    await bumpRevision(user.id)
    return { imported, duplicates, warnings }
  })

  app.delete('/api/chats', async (request, reply) => {
    const user = requireUser(request)
    const active = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.userId, user.id), isNull(chats.deletedAt)))
    const ids = active.map((chat) => chat.id)
    const now = new Date()
    const retention = await getTrashRetention(user.id)
    await db.update(chats).set({
      deletedAt: now,
      expiresAt: null,
      purgeStartedAt: retention === 'instant' ? now : null,
      updatedAt: now,
    }).where(and(eq(chats.userId, user.id), isNull(chats.deletedAt)))
    await cancelChatWork(ids)
    if (retention === 'instant' && ids.length) {
      await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId: user.id } }, {
        jobId: `purge-chats-delete-all-${user.id}-${Date.now()}`,
      })
    }
    await bumpRevision(user.id)
    reply.code(204).send()
  })

  app.delete('/api/chats/deleted', async (request, reply) => {
    const user = requireUser(request)
    const deleted = await db.select({ id: chats.id }).from(chats).where(and(
      eq(chats.userId, user.id), isNotNull(chats.deletedAt), isNull(chats.purgeStartedAt),
    ))
    const deleting = await markChatsForPurge(deleted.map((chat) => chat.id), user.id)
    if (deleting) {
      await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId: user.id } }, {
        jobId: `purge-chats-trash-all-${user.id}-${Date.now()}`,
      })
    }
    await bumpRevision(user.id)
    reply.code(202)
    return { deleting }
  })

  app.post('/api/chats', async (request, reply) => {
    const user = requireUser(request)
    const input = createChatSchema.parse(request.body)
    const [model] = await db.select({ id: models.id }).from(models).where(and(eq(models.id, input.modelId), eq(models.enabled, true))).limit(1)
    if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable')
    const id = input.clientId ?? newId()
    const createdAt = new Date()
    const expiresAt = input.temporary
      ? temporaryChatExpiresAt(createdAt)
      : await requestedNormalChatExpiry(user.id, input.autoExpire, createdAt)
    const [created] = await db.insert(chats).values({
      id,
      userId: user.id,
      modelId: input.modelId,
      title: input.title ?? 'New chat',
      temporary: input.temporary,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    }).onConflictDoNothing().returning()
    if (!created) {
      const [existing] = await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).limit(1)
      if (!existing) throw new AppError(409, 'chat_id_conflict', 'Chat identifier is already in use')
      return existing
    }
    if (created.temporary && created.expiresAt) {
      await scheduleTemporaryChatExpiry({ chatId: created.id, userId: user.id, expiresAt: created.expiresAt })
    }
    if (!created.temporary && created.expiresAt) {
      await scheduleNormalChatExpiry({ chatId: created.id, userId: user.id, expiresAt: created.expiresAt })
    }
    if (!created.temporary) await bumpRevision(user.id, id)
    reply.code(201)
    return created
  })

  app.post('/api/chats/start', async (request, reply) => {
    const user = requireUser(request)
    const input = startChatSchema.parse(request.body)
    if (input.response.parentResponseId) {
      throw new AppError(400, 'invalid_parent_response', 'A new chat cannot start from an existing response')
    }
    const [model] = await db.select({ id: models.id }).from(models).where(and(
      eq(models.id, input.chat.modelId), eq(models.enabled, true),
    )).limit(1)
    if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable')
    const createdAt = new Date()
    const expiresAt = input.chat.temporary
      ? temporaryChatExpiresAt(createdAt)
      : await requestedNormalChatExpiry(user.id, input.chat.autoExpire, createdAt)
    const [inserted] = await db.insert(chats).values({
      id: input.chat.clientId,
      userId: user.id,
      modelId: input.chat.modelId,
      title: input.chat.title ?? 'New chat',
      temporary: input.chat.temporary,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    }).onConflictDoNothing().returning()
    let chat = inserted
    if (!chat) {
      const [existing] = await db.select().from(chats).where(and(
        eq(chats.id, input.chat.clientId), eq(chats.userId, user.id), isNull(chats.deletedAt),
      )).limit(1)
      if (!existing) throw new AppError(409, 'chat_id_conflict', 'Chat identifier is already in use')
      chat = existing
    }
    try {
      const response = await createResponse({
        userId: user.id,
        chatId: chat.id,
        input: input.response,
        parentResponseId: null,
        idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      })
      if (!chat.temporary) await bumpRevision(user.id, chat.id)
      if (inserted && !chat.temporary && chat.expiresAt) {
        await scheduleNormalChatExpiry({ chatId: chat.id, userId: user.id, expiresAt: chat.expiresAt })
      }
      const [updatedChat] = await db.select().from(chats).where(eq(chats.id, chat.id)).limit(1)
      reply.code(202)
      return { chat: updatedChat ?? chat, response: toSnapshot(response) }
    } catch (error) {
      if (inserted) {
        if (input.response.attachmentIds.length) {
          await db.update(attachments).set({ chatId: null, updatedAt: new Date() }).where(and(
            eq(attachments.userId, user.id),
            eq(attachments.chatId, inserted.id),
            inArray(attachments.id, input.response.attachmentIds),
          ))
        }
        await db.delete(chats).where(and(eq(chats.id, inserted.id), eq(chats.userId, user.id)))
      }
      throw error
    }
  })

  app.post('/api/chats/:id/persist', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const now = new Date()
    const [current] = await db.select().from(chats).where(and(
      eq(chats.id, id),
      eq(chats.userId, user.id),
    )).limit(1)
    if (!current) throw notFound('Chat')
    if (temporaryChatIsExpired(current, now)) {
      throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
    }
    if (normalChatIsExpired(current, now)) throw notFound('Chat')
    if (current.deletedAt || current.purgeStartedAt) throw notFound('Chat')
    if (!current.temporary) return current

    const [updated] = await db.update(chats).set({
      temporary: false,
      expiresAt: null,
      updatedAt: now,
    }).where(and(
      eq(chats.id, id),
      eq(chats.userId, user.id),
      eq(chats.temporary, true),
      isNull(chats.deletedAt),
      isNull(chats.purgeStartedAt),
      accessibleChatCondition(now),
    )).returning()
    if (!updated) {
      const [afterRace] = await db.select().from(chats).where(and(
        eq(chats.id, id),
        eq(chats.userId, user.id),
      )).limit(1)
      if (afterRace && temporaryChatIsExpired(afterRace, new Date())) {
        throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
      }
      if (afterRace && !afterRace.temporary && !afterRace.deletedAt && !afterRace.purgeStartedAt) return afterRace
      throw notFound('Chat')
    }
    await bumpRevision(user.id, id)
    return updated
  })

  app.post('/api/chats/:id/duplicate', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [source] = await db.select().from(chats).where(and(
      eq(chats.id, id),
      eq(chats.userId, user.id),
      isNull(chats.deletedAt),
      eq(chats.temporary, false),
      accessibleChatCondition(),
    )).limit(1)
    if (!source) throw notFound('Chat')
    const sourceResponses = await db.select().from(responses).where(and(
      eq(responses.chatId, id),
      eq(responses.userId, user.id),
      isNull(responses.deletedAt),
    )).orderBy(asc(responses.createdAt), asc(responses.id))
    const chatId = newId()
    const plan = planDuplicateTree(sourceResponses, newId)
    const now = new Date()
    const title = source.title.endsWith(' copy') ? source.title : `${source.title} copy`
    const activeResponseId = source.activeResponseId ? plan.responseIds.get(source.activeResponseId) ?? null : null
    const activeBranchLeafId = source.activeBranchLeafId ? plan.responseIds.get(source.activeBranchLeafId) ?? null : null
    await db.transaction(async (tx) => {
      await tx.insert(chats).values({
        ...source,
        id: chatId,
        userId: user.id,
        title: title.slice(0, 200),
        pinned: false,
        temporary: false,
        activeResponseId,
        activeBranchLeafId,
        expiresAt: null,
        deletedAt: null,
        purgeStartedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      for (const response of sourceResponses) {
        const mapped = plan.remap(response)
        await tx.insert(responses).values({
          ...response,
          ...mapped,
          chatId,
          userId: user.id,
          openaiResponseId: null,
          idempotencyKey: null,
          createdAt: response.createdAt,
          updatedAt: now,
        })
      }
    })
    await bumpRevision(user.id, chatId)
    reply.code(201)
    return { ...source, id: chatId, title: title.slice(0, 200), pinned: false, temporary: false, activeResponseId, activeBranchLeafId, expiresAt: null, createdAt: now, updatedAt: now }
  })

  app.put('/api/chats/order', async (request) => {
    const user = requireUser(request)
    const body = request.body as { chatIds?: string[] }
    const chatIds = Array.isArray(body.chatIds) ? body.chatIds.filter((id) => typeof id === 'string') : []
    if (chatIds.length === 0 || chatIds.length > 5_000) {
      throw new AppError(400, 'validation_error', 'Chat order must include between 1 and 5,000 chat ids')
    }
    if (new Set(chatIds).size !== chatIds.length) {
      throw new AppError(400, 'validation_error', 'Chat order cannot contain duplicates')
    }
    const existing = await db.select({ id: chats.id }).from(chats).where(and(
      eq(chats.userId, user.id),
      isNull(chats.deletedAt),
      eq(chats.temporary, false),
      accessibleChatCondition(),
      inArray(chats.id, chatIds),
    ))
    if (existing.length !== chatIds.length) throw notFound('Chat')
    await db.transaction(async (tx) => {
      for (const [sortOrder, chatId] of chatIds.entries()) {
        await tx.update(chats)
          .set({ sortOrder })
          .where(and(eq(chats.id, chatId), eq(chats.userId, user.id), eq(chats.temporary, false)))
      }
    })
    await bumpRevision(user.id)
    return { data: chatIds }
  })

  app.get('/api/chats/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const query = request.query as { format?: string; scope?: string }
    const compact = query.format === 'compact'
    const activeScope = query.scope === 'active'
    const now = new Date()
    const [chat] = await db.select().from(chats).where(and(
      eq(chats.id, id),
      eq(chats.userId, user.id),
      isNull(chats.deletedAt),
      accessibleChatCondition(now),
    )).limit(1)
    if (!chat) {
      const [owned] = await db.select({ temporary: chats.temporary, expiresAt: chats.expiresAt })
        .from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id), isNull(chats.deletedAt))).limit(1)
      if (owned && temporaryChatIsExpired(owned, now)) {
        throw new AppError(410, 'temporary_chat_expired', 'This temporary chat has expired and cannot be recovered')
      }
      throw notFound('Chat')
    }
    const allTurns = await db.select()
      .from(responses)
      .where(and(eq(responses.chatId, id), isNull(responses.deletedAt)))
      .orderBy(asc(responses.createdAt), asc(responses.id))
    const referencedAttachmentIds = [...new Set(allTurns.flatMap((response) => responseAttachmentIds(response.input)))]
    const attachmentRows = referencedAttachmentIds.length ? await db.select({
      id: attachments.id,
      originalName: attachments.originalName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
    }).from(attachments).where(and(
      eq(attachments.userId, user.id),
      eq(attachments.status, 'ready'),
      inArray(attachments.id, referencedAttachmentIds),
    )) : []
    const queue = await listQueuedMessages(id, user.id)
    return {
      ...toPublicChat(chat),
      attachments: attachmentRows,
      queuedMessages: queue,
      responses: toPublicChatResponses(
        allTurns,
        chat.activeBranchLeafId ?? chat.activeResponseId,
        { compact, activeOnly: activeScope },
      ),
    }
  })

  app.patch('/api/chats/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const patch = updateChatSchema.parse(request.body)
    const now = new Date()
    const expiresAt = patch.autoExpire === undefined
      ? undefined
      : await requestedNormalChatExpiry(user.id, patch.autoExpire, now)
    const [updated] = await db.update(chats).set({
      title: patch.title?.trim(),
      pinned: patch.pinned,
      folderId: patch.folderId,
      modelId: patch.modelId,
      sortOrder: typeof patch.sortOrder === 'number' ? patch.sortOrder : undefined,
      expiresAt,
      updatedAt: now,
    }).where(and(
      eq(chats.id, id), eq(chats.userId, user.id), eq(chats.temporary, false),
      isNull(chats.deletedAt), isNull(chats.purgeStartedAt), accessibleChatCondition(now),
    )).returning()
    if (!updated) throw notFound('Chat')
    if (patch.autoExpire && updated.expiresAt) {
      await scheduleNormalChatExpiry({ chatId: updated.id, userId: user.id, expiresAt: updated.expiresAt })
    }
    await bumpRevision(user.id, id)
    return updated
  })

  app.delete('/api/chats/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const now = new Date()
    const retention = await getTrashRetention(user.id)
    const result = await db.update(chats).set({
      deletedAt: now,
      expiresAt: null,
      purgeStartedAt: retention === 'instant' ? now : null,
      updatedAt: now,
    }).where(and(eq(chats.id, id), eq(chats.userId, user.id), isNull(chats.deletedAt))).returning({ id: chats.id })
    if (!result.length) throw notFound('Chat')
    await db.delete(queuedMessages).where(and(eq(queuedMessages.chatId, id), eq(queuedMessages.userId, user.id)))
    await cancelChatWork([id])
    if (retention === 'instant') {
      await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId: user.id } }, {
        jobId: `purge-chat-${id}-${Date.now()}`,
      })
    }
    await bumpRevision(user.id, id)
    reply.code(204).send()
  })

  app.post('/api/chats/:id/recover', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [recovered] = await db.update(chats).set({ deletedAt: null, expiresAt: null, updatedAt: new Date() }).where(and(
      eq(chats.id, id),
      eq(chats.userId, user.id),
      eq(chats.temporary, false),
      isNotNull(chats.deletedAt),
      isNull(chats.purgeStartedAt),
    )).returning()
    if (!recovered) throw notFound('Deleted chat')
    await bumpRevision(user.id, id)
    return recovered
  })

  app.delete('/api/chats/:id/permanent', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const deleting = await markChatsForPurge([id], user.id)
    if (!deleting) throw notFound('Deleted chat')
    await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId: user.id } }, {
      jobId: `purge-chat-${id}-${Date.now()}`,
    })
    await bumpRevision(user.id, id)
    reply.code(202)
    return { deleting: 1 }
  })

  app.post('/api/chats/:id/responses', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const input = createChatResponseSchema.parse(request.body)
    if (input.parentResponseId) {
      const [parent] = await db.select({ id: responses.id }).from(responses).where(and(
        eq(responses.id, input.parentResponseId),
        eq(responses.chatId, id),
        eq(responses.userId, user.id),
        isNull(responses.deletedAt),
      )).limit(1)
      if (!parent) throw new AppError(400, 'invalid_parent_response', 'The selected parent response is unavailable')
    }
    const response = await createResponse({
      userId: user.id,
      chatId: id,
      input,
      parentResponseId: input.parentResponseId,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
    })
    await bumpRevision(user.id, id)
    reply.code(202)
    return { response: toSnapshot(response) }
  })

  app.post('/api/chats/:id/queued-messages', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const input = createQueuedMessageSchema.parse(request.body)
    const result = await createQueuedMessage(user.id, id, input)
    reply.code(202)
    return result
  })

  app.patch('/api/chats/:id/queued-messages/:messageId', async (request) => {
    const user = requireUser(request)
    const { id, messageId } = request.params as { id: string; messageId: string }
    const input = updateQueuedMessageSchema.parse(request.body)
    return { queuedMessage: await updateQueuedMessage(user.id, id, messageId, input) }
  })

  app.patch('/api/chats/:id/queued-messages/:messageId/reorder', async (request) => {
    const user = requireUser(request)
    const { id, messageId } = request.params as { id: string; messageId: string }
    const input = reorderQueuedMessageSchema.parse(request.body)
    return { queuedMessages: await reorderQueuedMessage(user.id, id, messageId, input) }
  })

  app.delete('/api/chats/:id/queued-messages/:messageId', async (request, reply) => {
    const user = requireUser(request)
    const { id, messageId } = request.params as { id: string; messageId: string }
    await deleteQueuedMessage(user.id, id, messageId)
    reply.code(204).send()
  })

  app.get('/api/responses/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [row] = await db.select({ response: responses }).from(responses)
      .innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(
        eq(responses.id, id),
        eq(responses.userId, user.id),
        isNull(responses.deletedAt),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      )).limit(1)
    if (!row) throw notFound('Response')
    return toSnapshot(row.response)
  })

  app.post('/api/responses/:id/cancel', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [row] = await db.select({ response: responses }).from(responses)
      .innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(
        eq(responses.id, id),
        eq(responses.userId, user.id),
        isNull(responses.deletedAt),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      )).limit(1)
    const response = row?.response
    if (!response) throw notFound('Response')
    if (!['queued', 'in_progress'].includes(response.status)) return toSnapshot(response)
    await requestCancellation(id)
    await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, id))
    await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: new Date(), error: 'Generation cancelled while waiting for capacity', updatedAt: new Date() }).where(and(eq(workspaceLeases.responseId, id), eq(workspaceLeases.status, 'provisioning')))
    const [log] = await db.update(requestLogs).set({ status: 'cancelled', errorCategory: 'cancellation', completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.responseId, id)).returning({ id: requestLogs.id })
    if (log) await publishAdminUsage(log.id, true)
    const [cancelled] = await db.select().from(responses).where(eq(responses.id, id)).limit(1)
    await advanceMessageQueue(response.chatId)
    return toSnapshot(cancelled!)
  })

  app.post('/api/responses/:id/continue-without-agent', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [row] = await db.select({ response: responses }).from(responses)
      .innerJoin(chats, eq(chats.id, responses.chatId))
      .where(and(
        eq(responses.id, id),
        eq(responses.userId, user.id),
        isNull(responses.deletedAt),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      )).limit(1)
    const response = row?.response
    if (!response) throw notFound('Response')
    if (!response.agentMode || !['queued', 'in_progress'].includes(response.status)) throw new AppError(409, 'agent_not_waiting', 'This response cannot continue without agent tools')
    const [waitingLease] = await db.select({ id: workspaceLeases.id, createdAt: workspaceLeases.createdAt }).from(workspaceLeases).where(and(eq(workspaceLeases.responseId, id), eq(workspaceLeases.status, 'provisioning'), inArray(workspaceLeases.capacityState, ['waiting', 'claiming']))).limit(1)
    if (!waitingLease) throw new AppError(409, 'agent_not_waiting', 'This response is not waiting for workspace capacity')
    if (!workspaceContinueWithoutAgentIsAvailable(waitingLease.createdAt)) {
      throw new AppError(409, 'agent_wait_required', 'Continue without agent tools is available after 15 seconds of waiting for workspace capacity')
    }
    await db.update(responses).set({ agentCapacityAction: 'continue_without_agent', updatedAt: new Date() }).where(eq(responses.id, id))
    const [updated] = await db.select().from(responses).where(eq(responses.id, id)).limit(1)
    return toSnapshot(updated!)
  })

  app.get('/api/folders', async (request) => {
    const user = requireUser(request)
    return {
      data: await db.select().from(folders)
        .where(eq(folders.userId, user.id))
        .orderBy(asc(folders.sortOrder), asc(folders.createdAt)),
    }
  })

  app.post('/api/folders', async (request, reply) => {
    const user = requireUser(request)
    const body = request.body as { clientId?: string; name?: string }
    const name = body.name?.trim()
    if (!name) throw new AppError(400, 'name_required', 'Folder name is required')
    const id = body.clientId ?? newId()
    const [sortRow] = await db.select({
      nextSortOrder: sql<number>`coalesce(max(${folders.sortOrder}), -1)::int + 1`,
    }).from(folders).where(eq(folders.userId, user.id))
    const [created] = await db.insert(folders).values({
      id,
      userId: user.id,
      name,
      sortOrder: sortRow?.nextSortOrder ?? 0,
    }).onConflictDoNothing().returning()
    if (!created) {
      const [existing] = await db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, user.id))).limit(1)
      if (!existing) throw new AppError(409, 'folder_id_conflict', 'Folder identifier is already in use')
      return existing
    }
    await bumpRevision(user.id)
    reply.code(201)
    return created
  })

  app.put('/api/folders/order', async (request) => {
    const user = requireUser(request)
    const body = request.body as { folderIds?: string[] }
    const folderIds = Array.isArray(body.folderIds) ? body.folderIds.filter((id) => typeof id === 'string') : []
    if (folderIds.length === 0 || folderIds.length > 1_000) {
      throw new AppError(400, 'validation_error', 'Folder order must include between 1 and 1,000 folder ids')
    }
    if (new Set(folderIds).size !== folderIds.length) {
      throw new AppError(400, 'validation_error', 'Folder order cannot contain duplicates')
    }
    const existing = await db.select({ id: folders.id }).from(folders).where(eq(folders.userId, user.id))
    const existingIds = new Set(existing.map((folder) => folder.id))
    if (folderIds.length !== existingIds.size || folderIds.some((folderId) => !existingIds.has(folderId))) {
      throw new AppError(400, 'validation_error', 'Folder order must contain every folder exactly once')
    }
    await db.transaction(async (tx) => {
      for (const [sortOrder, folderId] of folderIds.entries()) {
        await tx.update(folders)
          .set({ sortOrder, updatedAt: new Date() })
          .where(and(eq(folders.id, folderId), eq(folders.userId, user.id)))
      }
    })
    await bumpRevision(user.id)
    return { data: folderIds }
  })

  app.patch('/api/folders/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const patch = request.body as { name?: string; pinned?: boolean; sortOrder?: number }
    const name = patch.name?.trim()
    if (patch.name !== undefined && !name) throw new AppError(400, 'name_required', 'Folder name is required')
    const [updated] = await db.update(folders).set({
      name,
      pinned: patch.pinned,
      sortOrder: typeof patch.sortOrder === 'number' ? patch.sortOrder : undefined,
      updatedAt: new Date(),
    }).where(and(eq(folders.id, id), eq(folders.userId, user.id))).returning()
    if (!updated) throw notFound('Folder')
    await bumpRevision(user.id)
    return updated
  })

  app.delete('/api/folders/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await db.transaction(async (tx) => {
      await tx.update(chats).set({ folderId: null }).where(and(eq(chats.userId, user.id), eq(chats.folderId, id)))
      const deleted = await tx.delete(folders).where(and(eq(folders.id, id), eq(folders.userId, user.id))).returning({ id: folders.id })
      if (!deleted.length) throw notFound('Folder')
    })
    await bumpRevision(user.id)
    reply.code(204).send()
  })
}
