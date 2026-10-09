import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import { chats, queuedMessages } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { scheduleChatIndex } from '../episodic-memory/queue.js'
import { cancelChatWork, getTrashRetention } from './trash.js'

/** Moves chats to the trash (or deletes them, with instant retention). Returns the ids that changed. */
export async function trashChats(userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const now = new Date()
  const retention = await getTrashRetention(userId)
  const trashed = await db.update(chats).set({
    deletedAt: now,
    expiresAt: null,
    purgeStartedAt: retention === 'instant' ? now : null,
    updatedAt: now,
  }).where(and(inArray(chats.id, ids), eq(chats.userId, userId), isNull(chats.deletedAt))).returning({ id: chats.id })
  const trashedIds = trashed.map((row) => row.id)
  if (!trashedIds.length) return []
  await db.delete(queuedMessages).where(and(inArray(queuedMessages.chatId, trashedIds), eq(queuedMessages.userId, userId)))
  await cancelChatWork(trashedIds)
  if (retention === 'instant') {
    await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId } }, {
      jobId: `purge-chat-${trashedIds[0]}-${Date.now()}`,
    })
  }
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
  for (const chat of recovered) await scheduleChatIndex(chat.id, userId, 'chat-recovery')
  return recovered
}
