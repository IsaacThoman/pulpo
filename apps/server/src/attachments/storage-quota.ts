import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, attachments, fileNodes, users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { formatAttachmentSizeLimit } from '@pulpo/client-core'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

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

/** Bytes charged to the account: live chat attachments plus every Files blob, including trashed ones. */
export async function storageUsedBytes(executor: typeof db | DatabaseTransaction, userId: string): Promise<number> {
  const [[attachmentUsage], [fileUsage]] = await Promise.all([
    executor.select({ bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` }).from(attachments)
      .where(and(eq(attachments.userId, userId), inArray(attachments.status, ['pending', 'ready']))),
    executor.select({ bytes: sql<string>`coalesce(sum(${fileNodes.sizeBytes}), 0)::bigint` }).from(fileNodes)
      .where(and(eq(fileNodes.ownerUserId, userId), eq(fileNodes.kind, 'blob'))),
  ])
  return Number(attachmentUsage?.bytes ?? 0) + Number(fileUsage?.bytes ?? 0)
}

export async function getStorageUsage(userId: string): Promise<StorageUsage> {
  const [user] = await db.select({ limitBytes: users.storageLimitBytes }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw notFound('User')
  const usedBytes = await storageUsedBytes(db, userId)
  const limitBytes = Number(user.limitBytes)
  return { usedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - usedBytes) }
}

/**
 * Runs `insert` in a transaction that holds the account's storage lock after checking the
 * per-file cap and remaining quota, so concurrent reservations cannot overdraw storage.
 */
export async function withReservedStorage<T>(
  userId: string,
  sizeBytes: number,
  insert: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-storage:${userId}`}))`)
    const [[user], [setting]] = await Promise.all([
      tx.select({ storageLimitBytes: users.storageLimitBytes }).from(users).where(eq(users.id, userId)).limit(1),
      tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1),
    ])
    if (!user) throw notFound('User')
    const maxAttachmentBytes = parseAuthSettings(setting?.value).maxAttachmentBytes
    const sizeError = attachmentSizeError(sizeBytes, maxAttachmentBytes)
    if (sizeError) throw new AppError(413, 'attachment_too_large', sizeError, 'invalid_request_error')
    const usedBytes = await storageUsedBytes(tx, userId)
    if (!hasStorageCapacity(usedBytes, user.storageLimitBytes, sizeBytes)) {
      throw new AppError(413, 'storage_quota_exceeded', 'This file would exceed your storage allowance', 'invalid_request_error')
    }
    return insert(tx)
  })
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
  workspacePath?: string
  sourceResponseId?: string
  sourceToolCallId?: string
}): Promise<typeof attachments.$inferSelect> {
  return withReservedStorage(input.userId, input.sizeBytes, async (tx) => {
    const [created] = await tx.insert(attachments).values(input).returning()
    return created!
  })
}
