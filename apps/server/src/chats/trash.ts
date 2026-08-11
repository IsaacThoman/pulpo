import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { attachments, chats, memories, queuedMessages, responses, userPreferences, users } from '../database/schema.js'
import { getBlobStore } from '../storage/index.js'
import { releaseWorkspaceForChat } from '../agent/controller.js'
import { publishStateChange, requestCancellation } from '../responses/events.js'

export const trashRetentionValues = ['instant', '24h', '7d', '30d', '90d', 'indefinite'] as const
export type TrashRetention = typeof trashRetentionValues[number]
export const DEFAULT_TRASH_RETENTION: TrashRetention = '30d'

const retentionMs: Record<TrashRetention, number | null> = {
  instant: 0,
  '24h': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
  '90d': 90 * 24 * 60 * 60 * 1_000,
  indefinite: null,
}

export function parseTrashRetention(value: unknown): TrashRetention {
  return typeof value === 'string' && trashRetentionValues.includes(value as TrashRetention)
    ? value as TrashRetention
    : DEFAULT_TRASH_RETENTION
}

export function purgeAtFor(deletedAt: Date, retention: TrashRetention): Date | null {
  const duration = retentionMs[retention]
  return duration === null ? null : new Date(deletedAt.getTime() + duration)
}

export function expiredChatTrashValues(now: Date, retention: TrashRetention) {
  return {
    deletedAt: now,
    expiresAt: null,
    purgeStartedAt: retention === 'instant' ? now : null,
    updatedAt: now,
  }
}

export function normalChatExpiryCondition(
  chatId: string,
  userId: string,
  now: Date,
  expectedExpiresAt?: Date,
) {
  return and(
    eq(chats.id, chatId),
    eq(chats.userId, userId),
    eq(chats.temporary, false),
    lte(chats.expiresAt, now),
    expectedExpiresAt ? eq(chats.expiresAt, expectedExpiresAt) : undefined,
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
  )
}

export async function getTrashRetention(userId: string): Promise<TrashRetention> {
  const [row] = await db.select({ values: userPreferences.values }).from(userPreferences)
    .where(eq(userPreferences.userId, userId)).limit(1)
  return parseTrashRetention((row?.values as Record<string, unknown> | undefined)?.trashRetention)
}

export async function cancelChatWork(chatIds: string[]): Promise<void> {
  if (!chatIds.length) return
  const active = await db.select({ id: responses.id }).from(responses).where(and(
    inArray(responses.chatId, chatIds),
    inArray(responses.status, ['queued', 'in_progress']),
  ))
  await Promise.all(active.map((response) => requestCancellation(response.id)))
  await Promise.all(chatIds.map((chatId) => releaseWorkspaceForChat(chatId)))
}

export async function markChatsForPurge(chatIds: string[], userId?: string): Promise<number> {
  if (!chatIds.length) return 0
  const now = new Date()
  const marked = await db.update(chats).set({
    purgeStartedAt: now,
    updatedAt: now,
  }).where(and(
    inArray(chats.id, chatIds),
    isNotNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
    userId ? eq(chats.userId, userId) : undefined,
  )).returning({ id: chats.id })
  return marked.length
}

export async function markExpiredChatsForPurge(now = new Date(), userId?: string): Promise<number> {
  const deletedRows = await db.select({
    id: chats.id,
    userId: chats.userId,
    deletedAt: chats.deletedAt,
    preferences: userPreferences.values,
  }).from(chats)
    .leftJoin(userPreferences, eq(userPreferences.userId, chats.userId))
    .where(and(
      isNotNull(chats.deletedAt),
      isNull(chats.purgeStartedAt),
      userId ? eq(chats.userId, userId) : undefined,
    ))
  const expired = deletedRows.filter((row) => {
    if (!row.deletedAt) return false
    const deadline = purgeAtFor(row.deletedAt, parseTrashRetention((row.preferences as Record<string, unknown> | null)?.trashRetention))
    return deadline !== null && deadline <= now
  }).map((row) => row.id)

  const temporaryRows = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.temporary, true),
    lte(chats.expiresAt, now),
    isNull(chats.purgeStartedAt),
    userId ? eq(chats.userId, userId) : undefined,
  ))
  const normalCount = await markChatsForPurge(expired, userId)
  if (!temporaryRows.length) return normalCount
  const markedTemporary = await db.update(chats).set({
    deletedAt: now,
    purgeStartedAt: now,
    updatedAt: now,
  }).where(and(
    inArray(chats.id, temporaryRows.map((row) => row.id)),
    isNull(chats.purgeStartedAt),
    userId ? eq(chats.userId, userId) : undefined,
  )).returning({ id: chats.id })
  return normalCount + markedTemporary.length
}

export async function expireTemporaryChat(chatId: string, userId: string, now = new Date()): Promise<boolean> {
  const [marked] = await db.update(chats).set({
    deletedAt: now,
    purgeStartedAt: now,
    updatedAt: now,
  }).where(and(
    eq(chats.id, chatId),
    eq(chats.userId, userId),
    eq(chats.temporary, true),
    lte(chats.expiresAt, now),
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
  )).returning({ id: chats.id })
  return Boolean(marked)
}

async function publishExpiredChat(userId: string, chatId: string): Promise<void> {
  const [updated] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
  if (updated) await publishStateChange({ userId, chatId, revision: updated.revision })
}

export async function expireNormalChat(
  chatId: string,
  userId: string,
  now = new Date(),
  expectedExpiresAt?: Date,
): Promise<boolean> {
  const retention = await getTrashRetention(userId)
  const [marked] = await db.update(chats).set(expiredChatTrashValues(now, retention))
    .where(normalChatExpiryCondition(chatId, userId, now, expectedExpiresAt))
    .returning({ id: chats.id })
  if (!marked) return false
  const cleanup = await Promise.allSettled([
    db.delete(queuedMessages).where(and(eq(queuedMessages.chatId, chatId), eq(queuedMessages.userId, userId))),
    cancelChatWork([chatId]),
  ])
  await publishExpiredChat(userId, chatId)
  const failed = cleanup.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
  return true
}

export async function expireNormalChats(now = new Date(), userId?: string): Promise<number> {
  const expired = await db.select({ id: chats.id, userId: chats.userId }).from(chats).where(and(
    eq(chats.temporary, false),
    lte(chats.expiresAt, now),
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
    userId ? eq(chats.userId, userId) : undefined,
  ))
  let count = 0
  for (const chat of expired) {
    if (await expireNormalChat(chat.id, chat.userId, now)) count += 1
  }
  return count
}

export async function purgePendingChats(userId?: string): Promise<number> {
  const pending = await db.select({ id: chats.id, temporary: chats.temporary }).from(chats).where(and(
    isNotNull(chats.purgeStartedAt),
    userId ? eq(chats.userId, userId) : undefined,
  ))
  let purged = 0
  let firstError: unknown
  for (const row of pending) {
    try {
      const responseRows = await db.select({ id: responses.id, status: responses.status }).from(responses)
        .where(eq(responses.chatId, row.id))
      await Promise.all(responseRows.filter((response) => ['queued', 'in_progress'].includes(response.status))
        .map((response) => requestCancellation(response.id)))
      await releaseWorkspaceForChat(row.id)
      const files = await db.select({ objectKey: attachments.objectKey }).from(attachments)
        .where(eq(attachments.chatId, row.id))
      await Promise.all(files.map((file) => getBlobStore().delete(file.objectKey)))
      if (row.temporary) await db.delete(memories).where(eq(memories.sourceChatId, row.id))
      await db.delete(chats).where(and(eq(chats.id, row.id), isNotNull(chats.purgeStartedAt)))
      purged += 1
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
  return purged
}
