import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import { chats, queuedMessages } from '../database/schema.js'
import { queueTrashPurge } from '../jobs.js'
import { scheduleChatIndex } from '../episodic-memory/queue.js'
import { cancelChatWork, getTrashRetention, trashedChatValues } from './trash.js'
import { relatedChatIds } from './threads.js'

/** Moves chats to the trash (or deletes them, with instant retention). Returns the ids that changed. */
export async function trashChats(userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const now = new Date()
  const retention = await getTrashRetention(userId)
  const trashed = await db.update(chats).set(trashedChatValues(now, retention)).where(and(inArray(chats.id, ids), eq(chats.userId, userId), isNull(chats.deletedAt))).returning({ id: chats.id })
  if (!trashed.length) return []
  // Side chats and threads go with the chat they belong to.
  const related = await relatedChatIds(userId, trashed.map((row) => row.id))
  const trashedRelated = related.length
    ? await db.update(chats).set(trashedChatValues(now, retention)).where(and(inArray(chats.id, related), eq(chats.userId, userId), isNull(chats.deletedAt))).returning({ id: chats.id })
    : []
  const trashedIds = [...trashed, ...trashedRelated].map((row) => row.id)
  await db.delete(queuedMessages).where(and(inArray(queuedMessages.chatId, trashedIds), eq(queuedMessages.userId, userId)))
  await cancelChatWork(trashedIds)
  if (retention === 'instant') await queueTrashPurge(userId, 'trash')
  for (const id of trashedIds) await scheduleChatIndex(id, userId, 'chat-trash')
  return trashedIds
}

/** Brings trashed chats back. Returns the restored rows. */
export async function recoverChats(userId: string, ids: string[]) {
  if (!ids.length) return []
  const recovered = await db.update(chats).set({ deletedAt: null, expiresAt: null, updatedAt: new Date() }).where(and(
    inArray(chats.id, ids),
    eq(chats.userId, userId),
    eq(chats.temporary, false),
    isNotNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
  )).returning()
  // Side chats and threads come back with the chat they belong to; the caller gets that chat.
  const related = await relatedChatIds(userId, recovered.map((chat) => chat.id))
  const recoveredRelated = related.length ? await db.update(chats).set({ deletedAt: null, expiresAt: null, updatedAt: new Date() }).where(and(
    inArray(chats.id, related), eq(chats.userId, userId), isNotNull(chats.deletedAt), isNull(chats.purgeStartedAt),
  )).returning({ id: chats.id }) : []
  for (const chat of [...recovered, ...recoveredRelated]) await scheduleChatIndex(chat.id, userId, 'chat-recovery')
  return recovered
}
