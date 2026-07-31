import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createChatResponseSchema, createChatSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, folders, models, responses, users } from '../database/schema.js'
import { requireUser } from '../auth/service.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { createResponse, toSnapshot } from '../responses/service.js'
import { publishStateChange, requestCancellation } from '../responses/events.js'

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
      .send({ version: 1, exportedAt: new Date().toISOString(), chats: chatRows, responses: responseRows })
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
    const allTurns = await db.select().from(responses).where(eq(responses.chatId, id)).orderBy(responses.createdAt)
    const byId = new Map(allTurns.map((turn) => [turn.id, turn]))
    const turns: typeof allTurns = []
    let cursor = chat.activeBranchLeafId ?? chat.activeResponseId ?? allTurns.at(-1)?.id ?? null
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const turn = byId.get(cursor)
      if (!turn) break
      turns.unshift(turn)
      cursor = turn.parentResponseId
    }
    return { ...chat, responses: turns.map((response) => ({ ...response, snapshot: toSnapshot(response) })) }
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
    const [response] = await db.select().from(responses).where(and(eq(responses.id, id), eq(responses.userId, user.id))).limit(1)
    if (!response) throw notFound('Response')
    return toSnapshot(response)
  })

  app.post('/api/responses/:id/cancel', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [response] = await db.select().from(responses).where(and(eq(responses.id, id), eq(responses.userId, user.id))).limit(1)
    if (!response) throw notFound('Response')
    if (!['queued', 'in_progress'].includes(response.status)) return toSnapshot(response)
    await requestCancellation(id)
    await db.update(responses).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, id))
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
