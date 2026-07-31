import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { chats, chatShares, responses } from '../database/schema.js'
import { decryptSecret, encryptSecret, hashToken, randomToken } from '../lib/crypto.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { createRedis } from '../redis.js'
import { getConfig } from '../config.js'

function publicOutput(output: unknown[]): unknown[] {
  return output.filter((item) => (item as { type?: string }).type !== 'reasoning')
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  const redis = createRedis()
  app.addHook('onClose', async () => { await redis.quit() })
  app.get('/api/chat-shares', async (request) => {
    const user = requireUser(request)
    return { data: await db.select({ share: chatShares, title: chats.title }).from(chatShares)
      .innerJoin(chats, eq(chats.id, chatShares.chatId))
      .where(eq(chatShares.userId, user.id)).orderBy(desc(chatShares.createdAt)) }
  })

  app.post('/api/chat-shares', async (request, reply) => {
    const user = requireUser(request)
    const input = z.object({ chatId: z.uuid(), expiresAt: z.iso.datetime().nullable().default(null) }).parse(request.body)
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined
    const redisKey = idempotencyKey ? `pulpo:idempotency:share:${user.id}:${idempotencyKey}` : null
    if (redisKey) {
      const cached = await redis.get(redisKey)
      if (cached) { reply.code(201); return JSON.parse(decryptSecret(cached, getConfig().ENCRYPTION_KEY)) }
    }
    const [chat] = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, input.chatId), eq(chats.userId, user.id), isNull(chats.deletedAt))).limit(1)
    if (!chat) throw notFound('Chat')
    const token = randomToken(32)
    const [created] = await db.insert(chatShares).values({
      id: newId(), chatId: chat.id, userId: user.id, tokenHash: hashToken(token),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    }).returning()
    const result = { ...created, token }
    if (redisKey) await redis.set(redisKey, encryptSecret(JSON.stringify(result), getConfig().ENCRYPTION_KEY), 'EX', 86_400, 'NX')
    reply.code(201)
    return result
  })

  app.delete('/api/chat-shares/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const revoked = await db.update(chatShares).set({ revokedAt: new Date() })
      .where(and(eq(chatShares.id, id), eq(chatShares.userId, user.id))).returning({ id: chatShares.id })
    if (!revoked.length) throw notFound('Share')
    reply.code(204).send()
  })

  app.get('/api/shares/:token', async (request) => {
    const { token } = request.params as { token: string }
    const now = new Date()
    const [row] = await db.select({ share: chatShares, chat: chats }).from(chatShares)
      .innerJoin(chats, eq(chats.id, chatShares.chatId))
      .where(and(eq(chatShares.tokenHash, hashToken(token)), isNull(chatShares.revokedAt), or(isNull(chatShares.expiresAt), gt(chatShares.expiresAt, now))))
      .limit(1)
    if (!row) throw new AppError(404, 'share_not_found', 'This share does not exist or has expired')
    const allTurns = await db.select().from(responses).where(and(eq(responses.chatId, row.chat.id), isNull(responses.deletedAt))).orderBy(responses.createdAt)
    const turns = lineageFromLeaf(
      allTurns,
      row.chat.activeBranchLeafId ?? row.chat.activeResponseId ?? allTurns.at(-1)?.id ?? null,
    )
    return {
      id: row.share.id,
      chat: { id: row.chat.id, title: row.chat.title, modelId: row.chat.modelId, createdAt: row.chat.createdAt },
      responses: turns.map((turn) => ({
        id: turn.id, modelId: turn.modelId, status: turn.status, input: turn.input,
        output: publicOutput(turn.output as unknown[]), createdAt: turn.createdAt, completedAt: turn.completedAt,
      })),
    }
  })
}
