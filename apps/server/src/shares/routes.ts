import { and, asc, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { chatShareSnapshotSchema, type ChatShareSummary } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { attachments, chats, chatShares, responses } from '../database/schema.js'
import { decryptSecret, encryptSecret, hashToken, randomToken } from '../lib/crypto.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { createRedis } from '../redis.js'
import { getBlobStore } from '../storage/index.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { isConfirmedRasterImage } from '../attachments/policy.js'
import { createAttachmentThumbnail } from '../attachments/thumbnail.js'
import { createChatShareSnapshot } from './snapshot.js'
import { snapshotReferencesAttachment } from './policy.js'

const createShareSchema = z.object({
  chatId: z.uuid(),
  expiresAt: z.iso.datetime().nullable().default(null),
})

function activeShareCondition(now: Date) {
  return and(
    isNull(chatShares.revokedAt),
    isNotNull(chatShares.encryptedToken),
    isNotNull(chatShares.snapshot),
    or(isNull(chatShares.expiresAt), gt(chatShares.expiresAt, now)),
  )
}

function ownerSummary(share: typeof chatShares.$inferSelect): ChatShareSummary {
  if (!share.encryptedToken || !share.snapshot) throw new Error('Active share is missing snapshot data')
  const snapshot = chatShareSnapshotSchema.parse(share.snapshot)
  return {
    id: share.id,
    chatId: share.chatId,
    token: decryptSecret(share.encryptedToken, getConfig().ENCRYPTION_KEY),
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt?.toISOString() ?? null,
    responseCount: snapshot.responses.length,
  }
}

async function publicShare(token: string) {
  const now = new Date()
  const [row] = await db.select({ share: chatShares, chat: chats }).from(chatShares)
    .innerJoin(chats, eq(chats.id, chatShares.chatId))
    .where(and(
      eq(chatShares.tokenHash, hashToken(token)),
      activeShareCondition(now),
      isNull(chats.deletedAt),
      accessibleChatCondition(now),
    )).limit(1)
  if (!row?.share.snapshot) throw new AppError(404, 'share_not_found', 'This share does not exist or has expired')
  return { ...row, snapshot: chatShareSnapshotSchema.parse(row.share.snapshot) }
}

async function publicShareAttachment(token: string, attachmentId: string) {
  const shared = await publicShare(token)
  if (!snapshotReferencesAttachment(shared.snapshot, attachmentId)) throw notFound('Attachment')
  const [attachment] = await db.select().from(attachments).where(and(
    eq(attachments.id, attachmentId),
    eq(attachments.userId, shared.share.userId),
    eq(attachments.chatId, shared.share.chatId),
    eq(attachments.status, 'ready'),
  )).limit(1)
  if (!attachment) throw notFound('Attachment')
  return attachment
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  const redis = createRedis()
  app.addHook('onClose', async () => { await redis.quit() })

  app.get('/api/chat-shares', async (request) => {
    const user = requireUser(request)
    const query = z.object({ chatId: z.uuid().optional() }).parse(request.query)
    const now = new Date()
    const rows = await db.select({ share: chatShares }).from(chatShares)
      .innerJoin(chats, eq(chats.id, chatShares.chatId))
      .where(and(
        eq(chatShares.userId, user.id),
        query.chatId ? eq(chatShares.chatId, query.chatId) : undefined,
        activeShareCondition(now),
        isNull(chats.deletedAt),
        accessibleChatCondition(now),
      )).orderBy(desc(chatShares.createdAt))
    return { data: rows.map(({ share }) => ownerSummary(share)) }
  })

  app.post('/api/chat-shares', async (request, reply) => {
    const user = requireUser(request)
    const input = createShareSchema.parse(request.body)
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined
    const redisKey = idempotencyKey ? `pulpo:idempotency:share:${user.id}:${idempotencyKey}` : null
    if (redisKey) {
      const cached = await redis.get(redisKey)
      if (cached) {
        reply.code(201)
        return JSON.parse(decryptSecret(cached, getConfig().ENCRYPTION_KEY)) as ChatShareSummary
      }
    }
    const [chat] = await db.select().from(chats).where(and(
      eq(chats.id, input.chatId),
      eq(chats.userId, user.id),
      eq(chats.temporary, false),
      isNull(chats.deletedAt),
      accessibleChatCondition(),
    )).limit(1)
    if (!chat) throw notFound('Chat')
    const allTurns = await db.select().from(responses).where(and(
      eq(responses.chatId, chat.id),
      isNull(responses.deletedAt),
    )).orderBy(asc(responses.createdAt), asc(responses.id))
    const createdAt = new Date()
    const snapshot = await createChatShareSnapshot({ userId: user.id, chat, allTurns, sharedAt: createdAt })
    const token = randomToken(32)
    const [created] = await db.insert(chatShares).values({
      id: newId(),
      chatId: chat.id,
      userId: user.id,
      tokenHash: hashToken(token),
      encryptedToken: encryptSecret(token, getConfig().ENCRYPTION_KEY),
      snapshotVersion: snapshot.version,
      snapshot,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdAt,
    }).returning()
    if (!created) throw new AppError(500, 'share_create_failed', 'The share snapshot could not be created')
    const result = ownerSummary(created)
    if (redisKey) {
      await redis.set(redisKey, encryptSecret(JSON.stringify(result), getConfig().ENCRYPTION_KEY), 'EX', 86_400, 'NX')
    }
    reply.code(201)
    return result
  })

  app.delete('/api/chat-shares/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const revoked = await db.update(chatShares).set({ revokedAt: new Date() })
      .where(and(eq(chatShares.id, id), eq(chatShares.userId, user.id), isNull(chatShares.revokedAt)))
      .returning({ id: chatShares.id })
    if (!revoked.length) throw notFound('Share')
    reply.code(204).send()
  })

  app.get('/api/shares/:token', async (request) => {
    const { token } = z.object({ token: z.string().min(32).max(128) }).parse(request.params)
    const shared = await publicShare(token)
    return { id: shared.share.id, ...shared.snapshot }
  })

  app.get('/api/shares/:token/attachments/:attachmentId/content', async (request, reply) => {
    const { token, attachmentId } = z.object({ token: z.string().min(32).max(128), attachmentId: z.uuid() }).parse(request.params)
    const attachment = await publicShareAttachment(token, attachmentId)
    reply.type(attachment.mimeType)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`)
    return reply.send(await getBlobStore().getStream(attachment.objectKey))
  })

  app.get('/api/shares/:token/attachments/:attachmentId/download', async (request, reply) => {
    const { token, attachmentId } = z.object({ token: z.string().min(32).max(128), attachmentId: z.uuid() }).parse(request.params)
    const attachment = await publicShareAttachment(token, attachmentId)
    reply.type(attachment.mimeType)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`)
    return reply.send(await getBlobStore().getStream(attachment.objectKey))
  })

  app.get('/api/shares/:token/attachments/:attachmentId/thumbnail', async (request, reply) => {
    const { token, attachmentId } = z.object({ token: z.string().min(32).max(128), attachmentId: z.uuid() }).parse(request.params)
    const attachment = await publicShareAttachment(token, attachmentId)
    if (!isConfirmedRasterImage(attachment.mimeType)) throw notFound('Image preview')
    const etag = `"share-thumbnail-v1-${attachment.checksum ?? attachment.updatedAt.getTime()}"`
    reply.header('cache-control', 'private, max-age=3600').header('etag', etag)
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.type('image/webp').send(await createAttachmentThumbnail(await getBlobStore().getStream(attachment.objectKey)))
  })
}
