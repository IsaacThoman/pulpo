import type { Readable } from 'node:stream'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'
import { isLiveAssetHash, liveAssetHash } from '@pulpo/client-core/office'
import { attachmentRateLimit } from '../attachments/capacity.js'
import { db } from '../database/client.js'
import { applicationSettings, fileChanges, fileDocAssets } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { getBlobStore } from '../storage/index.js'
import { resolveFileAccess } from './access.js'
import { parseLiveSnapshot } from './agent/live.js'
import { hasVersion } from './agent/versions.js'
import { readObject } from './agent/live.js'
import { DocAssetStore, exportStoredDoc, textOfFile } from './live-docs.js'
import { requireFilesUser } from './request.js'
import { mutateFileTree } from './tree-service.js'
import { fileContentDisposition } from './upload-routes.js'

/** Largest asset an editor may upload, whatever the per-file cap allows. */
const ASSET_MAX_BYTES = 25 * 1024 * 1024
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i

const idParams = z.object({ id: z.uuid() })
const assetParams = z.object({ id: z.uuid(), hash: z.string().refine(isLiveAssetHash) })
const contentParams = z.object({ changeId: z.uuid(), side: z.enum(['before', 'after']) })

/**
 * Bytes that came from a user's file, sent so no browser renders them on the app's origin: always
 * a download, never sniffed, and sandboxed should anything open them anyway.
 */
function sendUntrusted(reply: FastifyReply, body: Uint8Array | Readable, input: { name: string; contentType: string; cache?: string }) {
  return reply
    .type(input.contentType)
    .header('content-disposition', fileContentDisposition('attachment', input.name))
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('cache-control', input.cache ?? 'private, no-store')
    .send(body)
}

async function readBody(body: unknown, maxBytes: number): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) throw tooLarge(maxBytes)
    return body
  }
  if (!body || typeof (body as Readable)[Symbol.asyncIterator] !== 'function') throw new AppError(400, 'validation_error', 'Send the asset bytes as application/octet-stream')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body as Readable) {
    total += (chunk as Uint8Array).byteLength
    if (total > maxBytes) throw tooLarge(maxBytes)
    chunks.push(Buffer.from(chunk as Uint8Array))
  }
  return Buffer.concat(chunks)
}

const tooLarge = (maxBytes: number) => new AppError(413, 'attachment_too_large', `Assets can be at most ${formatAttachmentSizeLimit(maxBytes)}`, 'invalid_request_error')

async function maxAssetBytes(): Promise<number> {
  const [setting] = await db.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
  return Math.min(parseAuthSettings(setting?.value).maxAttachmentBytes, ASSET_MAX_BYTES)
}

/**
 * Live documents as files and their parts: export (download through the codec), assets (images
 * and other binary parts editors fetch and add), and the stored versions an agent change compares.
 */
export async function registerLiveDocRoutes(app: FastifyInstance): Promise<void> {
  // The document as its real file, with edits not yet compacted.
  app.get('/api/files/:id/export', { config: attachmentRateLimit }, async (request, reply) => {
    const user = await requireFilesUser(request)
    const access = await resolveFileAccess(db, user.id, idParams.parse(request.params).id)
    if (!access || access.node.kind !== 'doc' || access.node.status !== 'ready') throw notFound('Document')
    const bytes = await exportStoredDoc(access.node)
    return sendUntrusted(reply, Buffer.from(bytes), { name: access.node.name, contentType: access.node.mimeType ?? 'application/octet-stream' })
  })

  // Content addressed, so a hash always means the same bytes and may be cached for good.
  app.get('/api/files/:id/assets/:hash', { config: attachmentRateLimit }, async (request, reply) => {
    const user = await requireFilesUser(request)
    const { id, hash } = assetParams.parse(request.params)
    const access = await resolveFileAccess(db, user.id, id)
    if (!access || access.node.kind !== 'doc') throw notFound('Asset')
    const [asset] = await db.select().from(fileDocAssets).where(and(eq(fileDocAssets.nodeId, id), eq(fileDocAssets.hash, hash))).limit(1)
    if (!asset) throw notFound('Asset')
    reply.header('x-pulpo-asset-type', MIME_TYPE.test(asset.mimeType) ? asset.mimeType : 'application/octet-stream')
    return sendUntrusted(reply, await getBlobStore().getStream(asset.objectKey), {
      name: hash, contentType: 'application/octet-stream', cache: 'private, max-age=31536000, immutable',
    })
  })

  // An editor adds a part (a pasted image, say). `type` is what the document will call it.
  app.put('/api/files/:id/assets', { config: attachmentRateLimit, bodyLimit: ASSET_MAX_BYTES + 65_536 }, async (request) => {
    const user = await requireFilesUser(request)
    const { id } = idParams.parse(request.params)
    const { type } = z.object({ type: z.string().regex(MIME_TYPE).optional() }).parse(request.query)
    const bytes = await readBody(request.body, await maxAssetBytes())
    if (!bytes.byteLength) throw new AppError(400, 'validation_error', 'The asset is empty')
    const hash = await liveAssetHash(bytes)
    const mimeType = type?.toLowerCase() ?? 'application/octet-stream'
    return mutateFileTree(user.id, async (tx) => {
      const access = await resolveFileAccess(tx, user.id, id)
      if (!access || access.node.kind !== 'doc' || access.node.trashedAt || access.node.status !== 'ready') throw notFound('Document')
      const [existing] = await tx.select().from(fileDocAssets).where(and(eq(fileDocAssets.nodeId, id), eq(fileDocAssets.hash, hash))).limit(1)
      if (existing) return { hash, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes }
      const store = new DocAssetStore(tx, id)
      const ref = await store.put(bytes, mimeType)
      await store.flush(tx, user.id, id)
      return ref
    }, ['files'], { reserveBytes: bytes.byteLength })
  })

  // Both sides of a live document's agent change as plain text (`codec.toText`): the diff any
  // client can show, whatever the format, until it has the format's own.
  app.get('/api/file-changes/:changeId/text', { config: attachmentRateLimit }, async (request) => {
    const user = await requireFilesUser(request)
    const { changeId } = contentParams.pick({ changeId: true }).parse(request.params)
    const [row] = await db.select().from(fileChanges).where(and(eq(fileChanges.id, changeId), eq(fileChanges.userId, user.id))).limit(1)
    const before = parseLiveSnapshot(row?.before)
    const after = parseLiveSnapshot(row?.after)
    const access = row ? await resolveFileAccess(db, user.id, row.nodeId) : null
    if (!row || !before || !after || !access || access.node.kind !== 'doc') throw notFound('Version')
    if (!await hasVersion(db, before.objectKey) || !await hasVersion(db, after.objectKey)) throw notFound('Version')
    const text = async (key: string) => textOfFile(db, access.node, await readObject(key))
    return { name: access.node.name, format: before.format, before: await text(before.objectKey), after: await text(after.objectKey) }
  })

  // One side of a live document's agent change, for the review diff.
  app.get('/api/file-changes/:changeId/content/:side', { config: attachmentRateLimit }, async (request, reply) => {
    const user = await requireFilesUser(request)
    const { changeId, side } = contentParams.parse(request.params)
    const [row] = await db.select().from(fileChanges).where(and(eq(fileChanges.id, changeId), eq(fileChanges.userId, user.id))).limit(1)
    const snapshot = parseLiveSnapshot(side === 'before' ? row?.before : row?.after)
    if (!row || !snapshot || !await hasVersion(db, snapshot.objectKey)) throw notFound('Version')
    const access = await resolveFileAccess(db, user.id, row.nodeId)
    return sendUntrusted(reply, await getBlobStore().getStream(snapshot.objectKey), {
      name: access?.node.name ?? 'version', contentType: snapshot.mimeType ?? 'application/octet-stream',
    })
  })
}
