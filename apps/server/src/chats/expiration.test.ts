import { afterEach, describe, expect, it, vi } from 'vitest'

const queueAdd = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: queueAdd } }))
import {
  automaticChatExpirationValues,
  automaticChatExpiresAt,
  DEFAULT_AUTOMATIC_CHAT_EXPIRATION,
  normalChatIsExpired,
  parseAutomaticChatExpiration,
  scheduleNormalChatExpiry,
} from './expiration.js'

afterEach(() => {
  queueAdd.mockClear()
  vi.useRealTimers()
})

describe('automatic normal-chat expiration', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('defaults missing and invalid settings to disabled', () => {
    expect(parseAutomaticChatExpiration(undefined)).toBe(DEFAULT_AUTOMATIC_CHAT_EXPIRATION)
    expect(parseAutomaticChatExpiration('30d')).toBe('disabled')
  })

  it('accepts only the public setting values', () => {
    for (const value of automaticChatExpirationValues) {
      expect(parseAutomaticChatExpiration(value)).toBe(value)
    }
  })

  it('calculates fixed deadlines from creation or enable time', () => {
    expect(automaticChatExpiresAt('disabled', now)).toBeNull()
    expect(automaticChatExpiresAt('24h', now)?.toISOString()).toBe('2026-08-11T12:00:00.000Z')
    expect(automaticChatExpiresAt('7d', now)?.toISOString()).toBe('2026-08-17T12:00:00.000Z')
  })

  it('expires only normal chats with a reached deadline', () => {
    expect(normalChatIsExpired({ temporary: false, expiresAt: now }, now)).toBe(true)
    expect(normalChatIsExpired({ temporary: false, expiresAt: new Date(now.getTime() + 1) }, now)).toBe(false)
    expect(normalChatIsExpired({ temporary: false, expiresAt: null }, now)).toBe(false)
    expect(normalChatIsExpired({ temporary: true, expiresAt: now }, now)).toBe(false)
  })

  it('schedules a deadline-specific delayed job for stale-job protection', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const expiresAt = new Date(now.getTime() + 86_400_000)

    await scheduleNormalChatExpiry({ chatId: 'chat-1', userId: 'user-1', expiresAt })

    expect(queueAdd).toHaveBeenCalledWith('expire-normal-chat', {
      type: 'expire-normal-chat',
      payload: { chatId: 'chat-1', userId: 'user-1', expectedExpiresAt: expiresAt.toISOString() },
    }, expect.objectContaining({
      jobId: `expire-normal-chat-chat-1-${expiresAt.getTime()}`,
      delay: 86_400_000,
    }))
  })
})
