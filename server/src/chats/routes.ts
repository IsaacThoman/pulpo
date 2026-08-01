import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createChatResponseSchema, createChatSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chatImportSources, chats, folders, models, requestLogs, responses, users } from '../database/schema.js'
import { requireUser } from '../auth/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { metadataForTurn } from '../messages/branching.js'
import { createResponse, toSnapshot } from '../responses/service.js'
import { publishStateChange, requestCancellation } from '../responses/events.js'
import { publishAdminUsage } from '../admin/usage-events.js'

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
      .where(and(eq(chats.userId, user.id), isNull(chats.deletedAt), eq(chats.temporary, false)))
      .orderBy(desc(chats.updatedAt))
    return { data: rows }
  })

  app.get('/api/chats/search', async (request) => {
    const user = requireUser(request)
    const query = String((request.query as { q?: string }).q ?? '').trim().slice(0, 200)
    if (!query) return { data: [] }
    const result = await db.execute<typeof chats.$inferSelect>(sql`
      select distinct c.* from chats c
      left join responses r on r.chat_id = c.id
      where c.user_id = ${user.id} and c.deleted_at is null and c.temporary = false
        and to_tsvector('simple', coalesce(c.title, '') || ' ' || coalesce(r.input::text, '') || ' ' || coalesce(r.output::text, ''))
          @@ plainto_tsquery('simple', ${query})
      order by c.updated_at desc limit 50
    `)
    return { data: [...result] }
  })

  app.get('/api/chats/export', async (request, reply) => {
    const user = requireUser(request)
    const chatRows = await db.select().from(chats).where(eq(chats.userId, user.id))
    const responseRows = await db.select().from(responses).where(eq(responses.userId, user.id))
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
    await db.update(chats).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(chats.userId, user.id))
    await bumpRevision(user.id)
    reply.code(204).send()
  })

  app.post('/api/chats', async (request, reply) => {
    const user = requireUser(request)
    const input = createChatSchema.parse(request.body)
    const [model] = await db.select({ id: models.id }).from(models).where(and(eq(models.id, input.modelId), eq(models.enabled, true))).limit(1)
    if (!model) throw new AppError(400, 'model_not_found', 'The selected model is unavailable')
    const id = input.clientId ?? newId()
    const expiresAt = input.temporary ? new Date(Date.now() + 86_400_000) : null
    const [created] = await db.insert(chats).values({
      id,
      userId: user.id,
      modelId: input.modelId,
      title: input.title ?? 'New chat',
      temporary: input.temporary,
      expiresAt,
    }).onConflictDoNothing().returning()
    if (!created) {
      const [existing] = await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id))).limit(1)
      if (!existing) throw new AppError(409, 'chat_id_conflict', 'Chat identifier is already in use')
      return existing
    }
    await bumpRevision(user.id, id)
    reply.code(201)
    return created
  })

  app.get('/api/chats/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [chat] = await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, user.id), isNull(chats.deletedAt))).limit(1)
    if (!chat) throw notFound('Chat')
    const allTurns = await db.select().from(responses).where(and(eq(responses.chatId, id), isNull(responses.deletedAt))).orderBy(responses.createdAt)
    return { ...chat, responses: allTurns.map((response) => ({
      ...response,
      snapshot: toSnapshot(response),
      branches: metadataForTurn(allTurns, response),
    })) }
  })

  app.patch('/api/chats/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const patch = request.body as { title?: string; pinned?: boolean; folderId?: string | null; modelId?: string }
    const [updated] = await db.update(chats).set({
      title: patch.title?.trim(),
      pinned: patch.pinned,
      folderId: patch.folderId,
      modelId: patch.modelId,
      updatedAt: new Date(),
    }).where(and(eq(chats.id, id), eq(chats.userId, user.id))).returning()
    if (!updated) throw notFound('Chat')
    await bumpRevision(user.id, id)
    return updated
  })

  app.delete('/api/chats/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const result = await db.update(chats).set({ deletedAt: new Date() }).where(and(eq(chats.id, id), eq(chats.userId, user.id))).returning({ id: chats.id })
    if (!result.length) throw notFound('Chat')
    await bumpRevision(user.id, id)
    reply.code(204).send()
  })

  app.post('/api/chats/:id/responses', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const input = createChatResponseSchema.parse(request.body)
    const response = await createResponse({
      userId: user.id,
      chatId: id,
      input,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
    })
    await bumpRevision(user.id, id)
    reply.code(202)
    return { response: toSnapshot(response) }
  })

  app.get('/api/responses/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [response] = await db.select().from(responses).where(and(eq(responses.id, id), eq(responses.userId, user.id), isNull(responses.deletedAt))).limit(1)
    if (!response) throw notFound('Response')
    return toSnapshot(response)
  })

  app.post('/api/responses/:id/cancel', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [response] = await db.select().from(responses).where(and(eq(responses.id, id), eq(responses.userId, user.id), isNull(responses.deletedAt))).limit(1)
    if (!response) throw notFound('Response')
    if (!['queued', 'in_progress'].includes(response.status)) return toSnapshot(response)
    await requestCancellation(id)
    await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, id))
    const [log] = await db.update(requestLogs).set({ status: 'cancelled', errorCategory: 'cancellation', completedAt: new Date(), updatedAt: new Date() }).where(eq(requestLogs.responseId, id)).returning({ id: requestLogs.id })
    if (log) await publishAdminUsage(log.id, true)
    const [cancelled] = await db.select().from(responses).where(eq(responses.id, id)).limit(1)
    return toSnapshot(cancelled!)
  })

  app.get('/api/folders', async (request) => {
    const user = requireUser(request)
    return { data: await db.select().from(folders).where(eq(folders.userId, user.id)) }
  })

  app.post('/api/folders', async (request, reply) => {
    const user = requireUser(request)
    const body = request.body as { clientId?: string; name?: string }
    const name = body.name?.trim()
    if (!name) throw new AppError(400, 'name_required', 'Folder name is required')
    const id = body.clientId ?? newId()
    const [created] = await db.insert(folders).values({ id, userId: user.id, name }).onConflictDoNothing().returning()
    if (!created) {
      const [existing] = await db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, user.id))).limit(1)
      if (!existing) throw new AppError(409, 'folder_id_conflict', 'Folder identifier is already in use')
      return existing
    }
    await bumpRevision(user.id)
    reply.code(201)
    return created
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
