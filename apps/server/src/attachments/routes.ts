import { and, eq, isNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { MAX_CONFIGURABLE_ATTACHMENT_BYTES } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { attachments, chats, noteMemberships, notes, queuedMessages, responses } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { getStorageUsage, reserveAttachment } from './storage-quota.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { canonicalUploadedMimeType, isConfirmedRasterImage } from './policy.js'
import { createAttachmentThumbnail } from './thumbnail.js'
import { attachmentReferenceIsLive } from './references.js'
import { AttachmentSizeMismatchError, exactSizeStream, inspectAttachmentStream } from './streams.js'
import { accessibleNote } from '../notes/service.js'

function accessibleAttachmentCondition() {
  return or(
    and(isNull(attachments.chatId), isNull(attachments.noteId)),
    and(isNull(chats.deletedAt), accessibleChatCondition()),
    and(isNull(notes.deletedAt), isNull(notes.purgeStartedAt)),
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

export async function registerAttachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/octet-stream', (_request, body, done) => done(null, body))

  const readyAttachment = async (userId: string, id: string) => {
    const [result] = await db.select({ attachment: attachments }).from(attachments)
      .leftJoin(chats, eq(chats.id, attachments.chatId))
      .leftJoin(notes, eq(notes.id, attachments.noteId))
      .leftJoin(noteMemberships, and(
        eq(noteMemberships.noteId, attachments.noteId),
        eq(noteMemberships.userId, userId),
      ))
      .where(and(
        eq(attachments.id, id),
        or(eq(attachments.userId, userId), eq(noteMemberships.userId, userId)),
        eq(attachments.status, 'ready'),
        accessibleAttachmentCondition(),
      )).limit(1)
    return result?.attachment
  }

  app.get('/api/attachments/usage', async (request) => {
    const user = requireUser(request)
    return getStorageUsage(user.id)
  })

  app.post('/api/attachments', async (request, reply) => {
    const user = requireUser(request)
    const input = z.object({
      chatId: z.uuid().nullable().default(null), originalName: z.string().trim().min(1).max(255),
      noteId: z.uuid().nullable().default(null),
      mimeType: z.string().min(1).max(255), sizeBytes: z.number().int().positive().max(MAX_CONFIGURABLE_ATTACHMENT_BYTES),
    }).refine((value) => !(value.chatId && value.noteId), 'Choose either a chat or note').parse(request.body)
    let storageOwnerId = user.id
    if (input.chatId) {
      const [chat] = await db.select({ id: chats.id }).from(chats).where(and(
        eq(chats.id, input.chatId),
        eq(chats.userId, user.id),
        isNull(chats.deletedAt),
        accessibleChatCondition(),
      )).limit(1)
      if (!chat) throw notFound('Chat')
    }
    if (input.noteId) {
      const access = await accessibleNote(user.id, input.noteId)
      if (access.role === 'viewer') throw new AppError(403, 'note_read_only', 'This note is read-only')
      storageOwnerId = access.note.ownerUserId
    }
    const id = newId()
    const objectKey = `users/${storageOwnerId}/attachments/${id}`
    const created = await reserveAttachment({
      id,
      userId: storageOwnerId,
      uploadedByUserId: user.id,
      objectKey,
      ...input,
    })
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
      .leftJoin(notes, eq(notes.id, attachments.noteId))
      .leftJoin(noteMemberships, and(eq(noteMemberships.noteId, attachments.noteId), eq(noteMemberships.userId, user.id)))
      .where(and(
        eq(attachments.objectKey, key),
        or(eq(attachments.userId, user.id), eq(attachments.uploadedByUserId, user.id)),
        eq(attachments.status, 'pending'),
        or(isNull(attachments.noteId), eq(noteMemberships.userId, user.id)),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    const contentLength = Number(request.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength !== attachment.sizeBytes) {
      throw new AppError(400, 'attachment_size_mismatch', 'Uploaded size does not match the declared size')
    }
    const body = request.body
    if (!(body instanceof Readable)) throw new AppError(400, 'attachment_body_invalid', 'Attachment upload body is invalid')
    try {
      await getBlobStore().putStream(key, exactSizeStream(body, attachment.sizeBytes), {
        contentType: attachment.mimeType,
        contentLength: attachment.sizeBytes,
      })
    } catch (cause) {
      if (cause instanceof AttachmentSizeMismatchError) {
        throw new AppError(400, 'attachment_size_mismatch', cause.message)
      }
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
      .leftJoin(notes, eq(notes.id, attachments.noteId))
      .leftJoin(noteMemberships, and(eq(noteMemberships.noteId, attachments.noteId), eq(noteMemberships.userId, user.id)))
      .where(and(
        eq(attachments.id, id),
        or(eq(attachments.userId, user.id), eq(attachments.uploadedByUserId, user.id)),
        or(isNull(attachments.noteId), eq(noteMemberships.userId, user.id)),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    try {
      const inspected = await inspectAttachmentStream(await getBlobStore().getStream(attachment.objectKey), attachment.sizeBytes)
      const checksum = inspected.checksum
      const mimeType = canonicalUploadedMimeType(attachment.mimeType, inspected.prefix)
      const [ready] = await db.update(attachments).set({ status: 'ready', checksum, mimeType, updatedAt: new Date() }).where(eq(attachments.id, id)).returning()
      return ready
    } catch (cause) {
      await db.update(attachments).set({ status: 'failed', error: cause instanceof Error ? cause.message : 'Validation failed', updatedAt: new Date() }).where(eq(attachments.id, id))
      throw new AppError(400, 'attachment_validation_failed', 'Attachment validation failed')
    }
  })

  app.get('/api/attachments/:id/download', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const attachment = await readyAttachment(user.id, id)
    if (!attachment) throw notFound('Attachment')
    return { url: await getBlobStore().createDownloadUrl(attachment.objectKey, 300) }
  })

  app.get('/api/attachments/:id/thumbnail', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const attachment = await readyAttachment(user.id, id)
    if (!attachment || !isConfirmedRasterImage(attachment.mimeType)) throw notFound('Image preview')
    const etag = `"thumbnail-v1-${attachment.checksum ?? attachment.updatedAt.getTime()}"`
    reply.header('cache-control', 'private, max-age=31536000, immutable').header('etag', etag)
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    try {
      const thumbnail = await createAttachmentThumbnail(await getBlobStore().getStream(attachment.objectKey))
      return reply.type('image/webp').send(thumbnail)
    } catch (cause) {
      request.log.warn({ err: cause, attachmentId: attachment.id }, 'Attachment thumbnail failed')
      throw new AppError(422, 'attachment_thumbnail_failed', 'Image preview could not be generated')
    }
  })

  app.get('/api/attachments/local-download/:key', async (request, reply) => {
    const user = requireUser(request)
    if (getConfig().STORAGE_DRIVER !== 'local') throw notFound('Download')
    const { key } = request.params as { key: string }
    const [result] = await db.select({ attachment: attachments }).from(attachments)
      .leftJoin(chats, eq(chats.id, attachments.chatId))
      .leftJoin(notes, eq(notes.id, attachments.noteId))
      .leftJoin(noteMemberships, and(
        eq(noteMemberships.noteId, attachments.noteId),
        eq(noteMemberships.userId, user.id),
      ))
      .where(and(
        eq(attachments.objectKey, key),
        or(eq(attachments.userId, user.id), eq(noteMemberships.userId, user.id)),
        eq(attachments.status, 'ready'),
        accessibleAttachmentCondition(),
      )).limit(1)
    const attachment = result?.attachment
    if (!attachment) throw notFound('Attachment')
    reply.type(attachment.mimeType).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`)
    return reply.send(await getBlobStore().getStream(key))
  })

  app.delete('/api/attachments/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const [attachment] = await db.select().from(attachments).where(and(
      eq(attachments.id, id),
      or(eq(attachments.userId, user.id), eq(attachments.uploadedByUserId, user.id)),
    )).limit(1)
    if (!attachment) throw notFound('Attachment')
    if (attachment.origin !== 'user') {
      throw new AppError(409, 'attachment_in_use', 'Generated attachments cannot be removed this way')
    }
    if (attachment.noteId && attachment.status === 'ready') {
      throw new AppError(409, 'attachment_in_use', 'Note attachments are retained until the note is permanently deleted')
    }
    const responseRows = await db.select({ input: responses.input }).from(responses).where(and(
      eq(responses.userId, user.id),
      isNull(responses.deletedAt),
    ))
    const queueRows = await db.select({ attachmentIds: queuedMessages.attachmentIds }).from(queuedMessages).where(
      eq(queuedMessages.userId, user.id),
    )
    const referenced = attachmentReferenceIsLive(
      id,
      responseRows.map((row) => row.input),
      queueRows.map((row) => row.attachmentIds),
    )
    if (referenced) throw new AppError(409, 'attachment_in_use', 'Attachment is still used by a message')
    await getBlobStore().delete(attachment.objectKey)
    await db.update(attachments).set({ status: 'deleted', updatedAt: new Date() }).where(eq(attachments.id, id))
    reply.code(204).send()
  })
}
