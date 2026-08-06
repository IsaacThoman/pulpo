import { createHash } from 'node:crypto'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { attachments, chats } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { getStorageUsage, reserveAttachment } from './storage-quota.js'
import { accessibleChatCondition } from '../chats/temporary.js'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.csv', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'])

function accessibleAttachmentCondition() {
  return or(
    isNull(attachments.chatId),
    and(isNull(chats.deletedAt), accessibleChatCondition()),
  )
}

export function attachmentUploadContentType(storageDriver: 'local' | 's3', mimeType: string): string {
  return storageDriver === 'local' ? 'application/octet-stream' : mimeType
}

export function attachmentStorageErrorCode(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    return `attachment_storage_${cause.code.toLowerCase()}`
  }
  return 'attachment_storage_error'
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index).toLowerCase()
}

export async function registerAttachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_ATTACHMENT_BYTES }, (_request, body, done) => done(null, body))

  app.get('/api/attachments/usage', async (request) => {
    const user = requireUser(request)
    return getStorageUsage(user.id)
  })

  app.post('/api/attachments', async (request, reply) => {
    const user = requireUser(request)
    const input = z.object({
      chatId: z.uuid().nullable().default(null), originalName: z.string().trim().min(1).max(255),
      mimeType: z.string().min(1).max(255), sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
    }).parse(request.body)
    const extension = extensionOf(input.originalName)
    if (!ALLOWED_EXTENSIONS.has(extension) || input.mimeType === 'text/html' || input.mimeType === 'image/svg+xml') {
      throw new AppError(400, 'attachment_type_not_allowed', 'This attachment type is not supported')
    }
    if (input.chatId) {
      const [chat] = await db.select({ id: chats.id }).from(chats).where(and(
        eq(chats.id, input.chatId),
        eq(chats.userId, user.id),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      )).limit(1)
      if (!chat) throw notFound('Chat')
    }
    const id = newId()
    const objectKey = `users/${user.id}/attachments/${id}`
    const created = await reserveAttachment({ id, userId: user.id, objectKey, ...input })
    const storageDriver = getConfig().STORAGE_DRIVER
    const uploadUrl = await getBlobStore().createUploadUrl(objectKey, { contentType: input.mimeType, contentLength: input.sizeBytes }, 900)
    reply.code(201)
    return { attachment: created, uploadUrl, uploadHeaders: { 'content-type': attachmentUploadContentType(storageDriver, input.mimeType) } }
  })

  app.put('/api/attachments/local-upload/:key', async (request, reply) => {
    const user = requireUser(request)
    if (getConfig().STORAGE_DRIVER !== 'local') throw notFound('Upload')
    const { key } = request.params as { key: string }
    const [result] = await db.select({ attachment: attachments }).from(attachments)
      .leftJoin(chats, eq(chats.id, attachments.chatId))
      .where(and(
        eq(attachments.objectKey, key),
        eq(attachments.userId, user.id),
        eq(attachments.status, 'pending'),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    const body = request.body as Buffer
    if (!Buffer.isBuffer(body) || body.byteLength !== attachment.sizeBytes) throw new AppError(400, 'attachment_size_mismatch', 'Uploaded size does not match the declared size')
    try {
      await getBlobStore().put(key, body, { contentType: attachment.mimeType, contentLength: body.byteLength })
    } catch (cause) {
      request.log.error({ err: cause }, 'Attachment storage write failed')
      throw new AppError(500, attachmentStorageErrorCode(cause), 'Attachment storage write failed', 'server_error')
    }
    reply.code(204).send()
  })

  app.post('/api/attachments/:id/confirm', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [result] = await db.select({ attachment: attachments }).from(attachments)
      .leftJoin(chats, eq(chats.id, attachments.chatId))
      .where(and(
        eq(attachments.id, id),
        eq(attachments.userId, user.id),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    try {
      const body = await getBlobStore().get(attachment.objectKey)
      if (body.byteLength !== attachment.sizeBytes) throw new Error('Uploaded size does not match')
      const checksum = createHash('sha256').update(body).digest('base64url')
      const [ready] = await db.update(attachments).set({ status: 'ready', checksum, updatedAt: new Date() }).where(eq(attachments.id, id)).returning()
      return ready
    } catch (cause) {
      await db.update(attachments).set({ status: 'failed', error: cause instanceof Error ? cause.message : 'Validation failed', updatedAt: new Date() }).where(eq(attachments.id, id))
      throw new AppError(400, 'attachment_validation_failed', 'Attachment validation failed')
    }
  })

  app.get('/api/attachments/:id/download', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [result] = await db.select({ attachment: attachments }).from(attachments)
      .leftJoin(chats, eq(chats.id, attachments.chatId))
      .where(and(
        eq(attachments.id, id),
        eq(attachments.userId, user.id),
        eq(attachments.status, 'ready'),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    return { url: await getBlobStore().createDownloadUrl(attachment.objectKey, 300) }
  })

  app.get('/api/attachments/local-download/:key', async (request, reply) => {
    const user = requireUser(request)
    if (getConfig().STORAGE_DRIVER !== 'local') throw notFound('Download')
    const { key } = request.params as { key: string }
    const [result] = await db.select({ attachment: attachments }).from(attachments)
      .leftJoin(chats, eq(chats.id, attachments.chatId))
      .where(and(
        eq(attachments.objectKey, key),
        eq(attachments.userId, user.id),
        eq(attachments.status, 'ready'),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    reply.type(attachment.mimeType).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`)
    return Buffer.from(await getBlobStore().get(key))
  })

  app.delete('/api/attachments/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [attachment] = await db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.userId, user.id))).limit(1)
    if (!attachment) throw notFound('Attachment')
    await getBlobStore().delete(attachment.objectKey)
    await db.update(attachments).set({ status: 'deleted', updatedAt: new Date() }).where(eq(attachments.id, id))
    reply.code(204).send()
  })
}
