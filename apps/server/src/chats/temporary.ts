import { and, eq, gt, or } from 'drizzle-orm'
import { chats } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'

export const TEMPORARY_CHAT_TTL_MS = 48 * 60 * 60 * 1_000

export function temporaryChatExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + TEMPORARY_CHAT_TTL_MS)
}

export function temporaryChatIsExpired(
  chat: { temporary: boolean; expiresAt: Date | null },
  now = new Date(),
): boolean {
  return chat.temporary && (!chat.expiresAt || chat.expiresAt <= now)
}

export function accessibleChatCondition(now = new Date()) {
  return or(
    eq(chats.temporary, false),
    and(eq(chats.temporary, true), gt(chats.expiresAt, now)),
  )
}

export async function scheduleTemporaryChatExpiry(input: {
  chatId: string
  userId: string
  expiresAt: Date
}): Promise<void> {
  const delay = Math.max(0, input.expiresAt.getTime() - Date.now())
  try {
    await maintenanceQueue.add('expire-temporary-chat', {
      type: 'expire-temporary-chat',
      payload: {
        chatId: input.chatId,
        userId: input.userId,
        expectedExpiresAt: input.expiresAt.toISOString(),
      },
    }, {
      jobId: `expire-temporary-chat-${input.chatId}-${input.expiresAt.getTime()}`,
      delay,
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    })
  } catch (error) {
    // The recurring cleanup worker is the recovery path if Redis is unavailable.
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'pulpo-api',
      event: 'temporary_chat.expiry_schedule_failed',
      chatId: input.chatId,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}
