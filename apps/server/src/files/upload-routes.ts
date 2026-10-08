import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { reserveFileUploadSchema } from '@pulpo/contracts'
import { attachmentRateLimit, withAttachmentCapacity } from '../attachments/capacity.js'
import { canonicalUploadedMimeType } from '../attachments/policy.js'
import { attachmentStorageErrorCode, attachmentUploadContentType } from '../attachments/routes.js'
import { withReservedStorage } from '../attachments/storage-quota.js'
import { AttachmentSizeMismatchError, exactSizeStream, inspectAttachmentStream } from '../attachments/streams.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { fileNodes, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { resolveFileAccess } from './access.js'
import { parseFileInput, requireFilesUser } from './request.js'
import { availableName, deleteFileNode, lockFileTree, mutateFileTree, toFileNode } from './tree-service.js'
import { topSortOrder } from './order.js'

const idParams = z.object({ id: z.uuid() })

export function fileContentDisposition(kind: 'attachment' | 'inline', name: string): string {
  return `${kind}; filename*=UTF-8''${encodeURIComponent(name)}`
}

async function ownedBlobByKey(userId: string, key: string, status: 'pending' | 'ready') {
  const [node] = await db.select().from(fileNodes).where(and(
    eq(fileNodes.objectKey, key),
    eq(fileNodes.ownerUserId, userId),
    eq(fileNodes.kind, 'blob'),
    eq(fileNodes.status, status),
  )).limit(1)
  return node
}

export async function registerFileUploadRoutes(app: FastifyInstance): Promise<void> {
  // Reserve storage and a sibling name, then hand back a URL for the bytes. The node stays
  // hidden from listings until the upload is confirmed.
  app.post('/api/files/uploads', { config: attachmentRateLimit }, async (request, reply) => {
    const user = await requireFilesUser(request)
    const input = parseFileInput(reserveFileUploadSchema, request.body)
    const id = newId()
    const objectKey = `users/${user.id}/files/${id}`
    const reservation = await withReservedStorage(user.id, input.sizeBytes, async (tx) => {
      // Do not mint upload URLs after deletion starts; acceptance waits for this short lock.
      const [owner] = await tx.select({ deleting: users.deletionRequestedAt }).from(users).where(eq(users.id, user.id)).for('share')
      if (!owner || owner.deleting) throw new AppError(403, 'account_deleting', 'Account deletion has started')
      await lockFileTree(tx, user.id)
      if (input.parentId) {
        const parent = await resolveFileAccess(tx, user.id, input.parentId)
        if (!parent || parent.node.trashedAt || parent.node.kind !== 'folder') throw notFound('Folder')
      }
      const name = await availableName(tx, user.id, input.parentId, input.name)
      const [node] = await tx.insert(fileNodes).values({
        id, ownerUserId: user.id, parentId: input.parentId, kind: 'blob', name, status: 'pending',
        mimeType: input.mimeType, sizeBytes: input.sizeBytes, objectKey,
        sortOrder: await topSortOrder(tx, user.id, input.parentId),
      }).returning()
      const uploadUrl = await getBlobStore().createUploadUrl(objectKey, { contentType: input.mimeType, contentLength: input.sizeBytes }, 900)
      return { node: toFileNode(node!), uploadUrl }
    })
    reply.code(201)
    return {
      ...reservation,
      uploadHeaders: { 'content-type': attachmentUploadContentType(getConfig().STORAGE_DRIVER, input.mimeType) },
    }
  })

  app.put('/api/files/local-upload/:key', { config: attachmentRateLimit }, withAttachmentCapacity(16, async (request, reply) => {
    const user = await requireFilesUser(request)
    if (getConfig().STORAGE_DRIVER !== 'local') throw notFound('Upload')
    const { key } = request.params as { key: string }
    const node = await ownedBlobByKey(user.id, key, 'pending')
    if (!node) throw notFound('Upload')
    const contentLength = Number(request.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength !== node.sizeBytes) {
      throw new AppError(400, 'attachment_size_mismatch', 'Uploaded size does not match the declared size')
    }
    const body = request.body
    if (!(body instanceof Readable)) throw new AppError(400, 'attachment_body_invalid', 'Upload body is invalid')
    try {
      await getBlobStore().putStream(key, exactSizeStream(body, node.sizeBytes), {
        contentType: node.mimeType ?? 'application/octet-stream',
        contentLength: node.sizeBytes,
      })
    } catch (cause) {
      if (cause instanceof AttachmentSizeMismatchError) throw new AppError(400, 'attachment_size_mismatch', cause.message)
      request.log.error({ err: cause }, 'File storage write failed')
      throw new AppError(500, attachmentStorageErrorCode(cause), 'File storage write failed', 'server_error')
    }
    const [owner] = await db.select({ deleting: users.deletionRequestedAt }).from(users).where(eq(users.id, user.id))
    if (!owner || owner.deleting) {
      // A streamed upload may finish after session revocation and the worker's file sweep.
      await getBlobStore().delete(key)
      throw new AppError(403, 'account_deleting', 'Account deletion has started')
    }
    reply.code(204).send()
  }))

  app.post('/api/files/:id/confirm', { config: attachmentRateLimit }, withAttachmentCapacity(8, async (request) => {
    const user = await requireFilesUser(request)
    const { id } = idParams.parse(request.params)
    const access = await resolveFileAccess(db, user.id, id)
    if (!access || access.node.kind !== 'blob') throw notFound('Upload')
    const node = access.node
    if (node.status === 'ready') return toFileNode(node)
    let inspected: Awaited<ReturnType<typeof inspectAttachmentStream>>
    try {
      inspected = await inspectAttachmentStream(await getBlobStore().getStream(node.objectKey!), node.sizeBytes)
    } catch {
      // Nothing usable was stored; release the name and the reserved storage.
      await deleteFileNode(user.id, id).catch(() => undefined)
      throw new AppError(400, 'attachment_validation_failed', 'The uploaded file could not be verified')
    }
    return mutateFileTree(user.id, async (tx) => {
      const [ready] = await tx.update(fileNodes).set({
        status: 'ready',
        checksum: inspected.checksum,
        mimeType: canonicalUploadedMimeType(node.mimeType ?? 'application/octet-stream', inspected.prefix),
        updatedAt: new Date(),
      }).where(and(eq(fileNodes.id, id), eq(fileNodes.status, 'pending'))).returning()
      if (!ready) throw notFound('Upload')
      return toFileNode(ready)
    })
  }))

  app.get('/api/files/:id/download', { config: attachmentRateLimit }, async (request) => {
    const user = await requireFilesUser(request)
    const { id } = idParams.parse(request.params)
    const access = await resolveFileAccess(db, user.id, id)
    if (!access || access.node.kind !== 'blob' || access.node.status !== 'ready') throw notFound('File')
    return {
      url: await getBlobStore().createDownloadUrl(access.node.objectKey!, 300, {
        contentDisposition: fileContentDisposition('attachment', access.node.name),
      }),
    }
  })

  app.get('/api/files/local-download/:key', { config: attachmentRateLimit }, async (request, reply) => {
    const user = await requireFilesUser(request)
    if (getConfig().STORAGE_DRIVER !== 'local') throw notFound('Download')
    const { key } = request.params as { key: string }
    const node = await ownedBlobByKey(user.id, key, 'ready')
    if (!node) throw notFound('File')
    reply.type(node.mimeType ?? 'application/octet-stream')
      .header('content-disposition', fileContentDisposition('attachment', node.name))
      .header('x-content-type-options', 'nosniff')
    return reply.send(await getBlobStore().getStream(key))
  })
}
