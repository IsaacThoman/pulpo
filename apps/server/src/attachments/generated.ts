import { basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { reserveAttachment } from './storage-quota.js'
import { detectImageMime } from '../agent/images.js'

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export interface GeneratedAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
}

function generatedName(path: string, requestedName?: string): string {
  const normalized = basename(requestedName?.trim() || path).normalize('NFKC')
  const name = [...normalized].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').slice(0, 255)
  if (!name || name === '.' || name === '..') throw new Error('Attachment name is invalid')
  return name
}

function generatedMimeType(name: string, data: Uint8Array): string {
  const expected = MIME_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
  if (!expected.startsWith('image/')) return expected
  const detected = detectImageMime(data)
  if (!detected || detected !== expected) throw new Error('Image contents do not match the filename')
  return detected
}

export function generatedAttachmentMetadata(path: string, requestedName: string | undefined, data: Uint8Array): { name: string; mimeType: string } {
  if (data.byteLength === 0) throw new Error('Empty files cannot be attached')
  const name = generatedName(path, requestedName)
  return { name, mimeType: generatedMimeType(name, data) }
}

export async function storeGeneratedAttachment(input: {
  responseId: string
  toolCallId: string
  userId: string
  chatId: string
  path: string
  requestedName?: string
  data: Uint8Array
}): Promise<GeneratedAttachment> {
  const { name, mimeType } = generatedAttachmentMetadata(input.path, input.requestedName, input.data)
  const [existing] = await db.select().from(attachments).where(and(
    eq(attachments.sourceResponseId, input.responseId),
    eq(attachments.sourceToolCallId, input.toolCallId),
  )).limit(1)
  if (existing?.status === 'ready') return { id: existing.id, name: existing.originalName, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes }
  const reusablePending = existing?.status === 'pending'
    && existing.originalName === name
    && existing.mimeType === mimeType
    && existing.sizeBytes === input.data.byteLength
  if (existing && !reusablePending) await db.delete(attachments).where(eq(attachments.id, existing.id))

  const id = reusablePending ? existing.id : newId()
  const objectKey = `users/${input.userId}/attachments/${id}`
  const attachment = reusablePending ? existing : await reserveAttachment({
    id, userId: input.userId, chatId: input.chatId, objectKey, originalName: name, mimeType,
    sizeBytes: input.data.byteLength, origin: 'assistant', sourceResponseId: input.responseId, sourceToolCallId: input.toolCallId,
  })
  try {
    const checksum = createHash('sha256').update(input.data).digest('base64url')
    await getBlobStore().put(objectKey, input.data, {
      contentType: mimeType, contentLength: input.data.byteLength,
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    await db.update(attachments).set({ status: 'ready', checksum, updatedAt: new Date() }).where(eq(attachments.id, id))
    return { id, name, mimeType, sizeBytes: attachment.sizeBytes }
  } catch (error) {
    await getBlobStore().delete(objectKey).catch(() => undefined)
    await db.update(attachments).set({ status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(attachments.id, id))
    throw error
  }
}
