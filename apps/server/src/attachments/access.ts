import { and, eq, isNull, or } from 'drizzle-orm'
import { accessibleChatCondition } from '../chats/temporary.js'
import { db } from '../database/client.js'
import { attachments, chats } from '../database/schema.js'

export function accessibleAttachmentCondition() {
  return or(
    isNull(attachments.chatId),
    and(isNull(chats.deletedAt), accessibleChatCondition()),
  )
}

/** The user's own ready attachment, unless it belongs to a deleted or inaccessible chat. */
export async function readyAttachment(userId: string, id: string) {
  const [result] = await db.select({ attachment: attachments }).from(attachments)
    .leftJoin(chats, eq(chats.id, attachments.chatId))
    .where(and(
      eq(attachments.id, id),
      eq(attachments.userId, userId),
      eq(attachments.status, 'ready'),
      accessibleAttachmentCondition(),
    )).limit(1)
  return result?.attachment
}
