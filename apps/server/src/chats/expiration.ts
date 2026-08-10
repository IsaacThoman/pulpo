import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { userPreferences } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'

export const automaticChatExpirationValues = ['disabled', '24h', '7d'] as const
export type AutomaticChatExpiration = typeof automaticChatExpirationValues[number]
export const DEFAULT_AUTOMATIC_CHAT_EXPIRATION: AutomaticChatExpiration = 'disabled'

const expirationMs: Record<AutomaticChatExpiration, number | null> = {
  disabled: null,
  '24h': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
}

export function parseAutomaticChatExpiration(value: unknown): AutomaticChatExpiration {
  return typeof value === 'string' && automaticChatExpirationValues.includes(value as AutomaticChatExpiration)
    ? value as AutomaticChatExpiration
    : DEFAULT_AUTOMATIC_CHAT_EXPIRATION
}

export function automaticChatExpiresAt(value: AutomaticChatExpiration, now = new Date()): Date | null {
  const duration = expirationMs[value]
  return duration === null ? null : new Date(now.getTime() + duration)
}

export async function getAutomaticChatExpiration(userId: string): Promise<AutomaticChatExpiration> {
  const [row] = await db.select({ values: userPreferences.values }).from(userPreferences)
    .where(eq(userPreferences.userId, userId)).limit(1)
  return parseAutomaticChatExpiration(
    (row?.values as Record<string, unknown> | undefined)?.automaticChatExpiration,
  )
}

export function normalChatIsExpired(
  chat: { temporary: boolean; expiresAt: Date | null },
  now = new Date(),
): boolean {
  return !chat.temporary && chat.expiresAt !== null && chat.expiresAt <= now
}

export async function scheduleNormalChatExpiry(input: {
  chatId: string
  userId: string
  expiresAt: Date
}): Promise<void> {
  const delay = Math.max(0, input.expiresAt.getTime() - Date.now())
  try {
    await maintenanceQueue.add('expire-normal-chat', {
      type: 'expire-normal-chat',
      payload: {
        chatId: input.chatId,
        userId: input.userId,
        expectedExpiresAt: input.expiresAt.toISOString(),
      },
    }, {
      jobId: `expire-normal-chat-${input.chatId}-${input.expiresAt.getTime()}`,
      delay,
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    })
  } catch (error) {
    // The recurring cleanup worker is the recovery path if Redis is unavailable.
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'pulpo-api',
      event: 'normal_chat.expiry_schedule_failed',
      chatId: input.chatId,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}
