import { apiRequest, fetchApiBlob } from '@/lib/api'
import { localAccountKey, localDb, type CachedAttachmentRow } from './database'
import { adminChatAccessActive } from '@/features/admin-chat/access'

export interface AttachmentMetadata {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

const pendingAttachmentCaches = new Map<string, Promise<boolean>>()

export function attachmentQuotaBytes(quotaMb: number): number {
  if (!Number.isFinite(quotaMb)) return 50 * 1024 * 1024
  return Math.max(0, Math.floor(quotaMb * 1024 * 1024))
}

async function pruneAttachmentCache(userId: string, quotaBytes: number): Promise<void> {
  const rows = await localDb.attachmentBlobs.where('userId').equals(localAccountKey(userId)).sortBy('lastAccessed')
  let total = rows.reduce((sum, row) => sum + row.sizeBytes, 0)
  const remove: string[] = []
  for (const row of rows) {
    if (total <= quotaBytes) break
    total -= row.sizeBytes
    remove.push(row.id)
  }
  if (remove.length) await localDb.attachmentBlobs.bulkDelete(remove)
}

export async function cacheAttachmentBlob(
  userId: string,
  metadata: AttachmentMetadata,
  blob: Blob,
  quotaMb: number,
): Promise<boolean> {
  if (adminChatAccessActive()) return false
  const quotaBytes = attachmentQuotaBytes(quotaMb)
  if (quotaBytes === 0 || blob.size > quotaBytes) return false
  const row: CachedAttachmentRow = {
    ...metadata,
    userId: localAccountKey(userId),
    sizeBytes: blob.size,
    blob,
    lastAccessed: Date.now(),
  }
  await localDb.transaction('rw', localDb.attachmentBlobs, async () => {
    await localDb.attachmentBlobs.put(row)
    await pruneAttachmentCache(userId, quotaBytes)
  })
  return true
}

export async function getCachedAttachment(userId: string, id: string): Promise<CachedAttachmentRow | undefined> {
  if (adminChatAccessActive()) return undefined
  const row = await localDb.attachmentBlobs.get(id)
  if (!row || row.userId !== localAccountKey(userId)) return undefined
  await localDb.attachmentBlobs.update(id, { lastAccessed: Date.now() })
  return row
}

export async function enforceAttachmentQuota(userId: string, quotaMb: number): Promise<void> {
  await pruneAttachmentCache(userId, attachmentQuotaBytes(quotaMb))
}

async function cacheRemoteAttachment(
  userId: string,
  metadata: AttachmentMetadata,
  quotaMb: number,
): Promise<boolean> {
  if (await getCachedAttachment(userId, metadata.id)) return true
  if (metadata.sizeBytes > attachmentQuotaBytes(quotaMb)) return false
  const { url } = await apiRequest<{ url: string }>(`/api/attachments/${metadata.id}/download`)
  const blob = await fetchApiBlob(url)
  return cacheAttachmentBlob(userId, metadata, blob, quotaMb)
}

export function ensureAttachmentCached(
  userId: string,
  metadata: AttachmentMetadata,
  quotaMb: number,
): Promise<boolean> {
  const key = `${userId}:${metadata.id}`
  const current = pendingAttachmentCaches.get(key)
  if (current) return current
  const pending = cacheRemoteAttachment(userId, metadata, quotaMb)
    .finally(() => {
      if (pendingAttachmentCaches.get(key) === pending) pendingAttachmentCaches.delete(key)
    })
  pendingAttachmentCaches.set(key, pending)
  return pending
}

export async function downloadAttachment(
  userId: string,
  metadata: AttachmentMetadata,
  quotaMb: number,
): Promise<void> {
  let cached = await getCachedAttachment(userId, metadata.id)
  if (!cached) {
    try {
      if (await ensureAttachmentCached(userId, metadata, quotaMb)) {
        cached = await getCachedAttachment(userId, metadata.id)
      }
    } catch {
      // Fall back to a direct download when local caching is unavailable.
    }
  }
  const anchor = document.createElement('a')
  anchor.download = cached?.originalName ?? metadata.originalName
  if (cached) {
    const url = URL.createObjectURL(cached.blob)
    anchor.href = url
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    return
  }
  const result = await apiRequest<{ url: string }>(`/api/attachments/${metadata.id}/download`)
  anchor.href = result.url
  anchor.click()
}
