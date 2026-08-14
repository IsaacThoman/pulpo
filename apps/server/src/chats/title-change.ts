import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { chats, users } from '../database/schema.js'
import { publishStateChange } from '../responses/events.js'

export async function persistGeneratedChatTitle(input: {
  userId: string
  chatId: string
  title: string
}): Promise<boolean> {
  const change = await db.transaction(async (tx) => {
    const [updated] = await tx.update(chats).set({
      title: input.title,
      updatedAt: new Date(),
    }).where(and(
      eq(chats.id, input.chatId),
      eq(chats.userId, input.userId),
      ne(chats.title, input.title),
    )).returning({
      chatId: chats.id,
      userId: chats.userId,
    })
    if (!updated) return undefined

    const [account] = await tx.update(users).set({
      stateRevision: sql`${users.stateRevision} + 1`,
    }).where(eq(users.id, input.userId)).returning({
      revision: users.stateRevision,
    })
    if (!account) throw new Error('Chat owner disappeared while persisting a generated title')

    return {
      userId: updated.userId,
      chatId: updated.chatId,
      revision: account.revision,
    }
  })

  if (!change) return false
  await publishStateChange(change)
  return true
}
