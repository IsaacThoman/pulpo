import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, attachments, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'

export interface StorageUsage {
  usedBytes: number
  limitBytes: number
  remainingBytes: number
}

export function hasStorageCapacity(usedBytes: number, limitBytes: number, requestedBytes: number): boolean {
  return requestedBytes <= Math.max(0, limitBytes - usedBytes)
}

export function attachmentSizeError(sizeBytes: number, maxAttachmentBytes: number): string | null {
  return sizeBytes > maxAttachmentBytes
    ? `Attachment exceeds the ${formatAttachmentSizeLimit(maxAttachmentBytes)} limit`
    : null
}

export async function getStorageUsage(userId: string): Promise<StorageUsage> {
  const [row] = await db.select({
    limitBytes: users.storageLimitBytes,
    usedBytes: sql<number>`coalesce(sum(${attachments.sizeBytes}) filter (where ${attachments.status} in ('pending', 'ready')), 0)::bigint`,
  }).from(users).leftJoin(attachments, eq(attachments.userId, users.id)).where(eq(users.id, userId)).groupBy(users.id).limit(1)
  if (!row) throw notFound('User')
  const usedBytes = Number(row.usedBytes)
  const limitBytes = Number(row.limitBytes)
  return { usedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - usedBytes) }
}

export async function reserveAttachment(input: {
  id: string
  userId: string
  chatId: string | null
  objectKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  origin?: string
  sourceResponseId?: string
  sourceToolCallId?: string
}): Promise<typeof attachments.$inferSelect> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-storage:${input.userId}`}))`)
    const [[user], [setting]] = await Promise.all([
      tx.select({ storageLimitBytes: users.storageLimitBytes }).from(users).where(eq(users.id, input.userId)).limit(1),
      tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1),
    ])
    if (!user) throw notFound('User')
    const maxAttachmentBytes = parseAuthSettings(setting?.value).maxAttachmentBytes
    const sizeError = attachmentSizeError(input.sizeBytes, maxAttachmentBytes)
    if (sizeError) throw new AppError(413, 'attachment_too_large', sizeError, 'invalid_request_error')
    const [usage] = await tx.select({
      usedBytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint`,
    }).from(attachments).where(and(eq(attachments.userId, input.userId), inArray(attachments.status, ['pending', 'ready'])))
    const usedBytes = Number(usage?.usedBytes ?? 0)
    if (!hasStorageCapacity(usedBytes, user.storageLimitBytes, input.sizeBytes)) {
      throw new AppError(413, 'storage_quota_exceeded', 'This file would exceed your storage allowance', 'invalid_request_error')
    }
    const [created] = await tx.insert(attachments).values(input).returning()
    return created!
  })
}
