import { apiRequest } from '@/lib/api'
import { localDb, type CachedAttachmentRow } from './database'

export interface AttachmentMetadata {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

export function attachmentQuotaBytes(quotaMb: number): number {
  if (!Number.isFinite(quotaMb)) return 50 * 1024 * 1024
  return Math.max(0, Math.floor(quotaMb * 1024 * 1024))
}

async function pruneAttachmentCache(userId: string, quotaBytes: number): Promise<void> {
  const rows = await localDb.attachmentBlobs.where('userId').equals(userId).sortBy('lastAccessed')
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
  const quotaBytes = attachmentQuotaBytes(quotaMb)
  if (quotaBytes === 0 || blob.size > quotaBytes) return false
  const row: CachedAttachmentRow = {
    ...metadata,
    userId,
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
  const row = await localDb.attachmentBlobs.get(id)
  if (!row || row.userId !== userId) return undefined
  await localDb.attachmentBlobs.update(id, { lastAccessed: Date.now() })
  return row
}

export async function enforceAttachmentQuota(userId: string, quotaMb: number): Promise<void> {
  await pruneAttachmentCache(userId, attachmentQuotaBytes(quotaMb))
}

export async function ensureAttachmentCached(
  userId: string,
  metadata: AttachmentMetadata,
  quotaMb: number,
): Promise<boolean> {
  if (await getCachedAttachment(userId, metadata.id)) return true
  if (metadata.sizeBytes > attachmentQuotaBytes(quotaMb)) return false
  const { url } = await apiRequest<{ url: string }>(`/api/attachments/${metadata.id}/download`)
  const response = await fetch(url, { credentials: url.startsWith('/api/') ? 'include' : 'omit' })
  if (!response.ok) throw new Error(`Attachment download failed (${response.status})`)
  const blob = await response.blob()
  return cacheAttachmentBlob(userId, metadata, blob, quotaMb)
}

export async function warmAttachmentCache(
  userId: string,
  attachments: AttachmentMetadata[],
  quotaMb: number,
): Promise<void> {
  await enforceAttachmentQuota(userId, quotaMb)
  const quotaBytes = attachmentQuotaBytes(quotaMb)
  let plannedBytes = 0
  for (const attachment of attachments) {
    if (plannedBytes + attachment.sizeBytes > quotaBytes) continue
    plannedBytes += attachment.sizeBytes
    try {
      await ensureAttachmentCached(userId, attachment, quotaMb)
    } catch {
      // A chat remains usable when an attachment cannot be cached.
    }
  }
}

export async function downloadAttachment(userId: string, id: string, fallbackName: string): Promise<void> {
  const cached = await getCachedAttachment(userId, id)
  const anchor = document.createElement('a')
  anchor.download = cached?.originalName ?? fallbackName
  if (cached) {
    const url = URL.createObjectURL(cached.blob)
    anchor.href = url
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    return
  }
  const result = await apiRequest<{ url: string }>(`/api/attachments/${id}/download`)
  anchor.href = result.url
  anchor.click()
}
