import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '../database/client.js'
import { chats } from '../database/schema.js'

export function chatAllowsMemory(chat: { temporary: boolean } | null | undefined): boolean {
  // Missing chat state must never grant access to account memory.
  return chat?.temporary === false
}

export async function chatCanAccessMemory(userId: string, chatId: string): Promise<boolean> {
  const [chat] = await db.select({ temporary: chats.temporary }).from(chats).where(and(
    eq(chats.id, chatId), eq(chats.userId, userId),
    isNull(chats.deletedAt), isNull(chats.purgeStartedAt),
    or(isNull(chats.expiresAt), gt(chats.expiresAt, new Date())),
  )).limit(1)
  return chatAllowsMemory(chat)
}
