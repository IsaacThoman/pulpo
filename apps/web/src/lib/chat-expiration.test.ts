import { describe, expect, it } from 'vitest'
import { formatChatExpiryRemaining } from './chat-expiration'

describe('chat expiration labels', () => {
  const now = Date.parse('2026-08-10T12:00:00.000Z')

  it('uses compact day, hour, and minute units', () => {
    expect(formatChatExpiryRemaining(now + 7 * 24 * 60 * 60_000, now)).toBe('7d')
    expect(formatChatExpiryRemaining(now + ((2 * 24 * 60 + 3 * 60 + 4) * 60_000), now)).toBe('2d 3h 4m')
    expect(formatChatExpiryRemaining(now + 45 * 60_000, now)).toBe('45m')
  })

  it('rounds a partial minute up and handles elapsed deadlines', () => {
    expect(formatChatExpiryRemaining(now + 1, now)).toBe('1m')
    expect(formatChatExpiryRemaining(now, now)).toBe('now')
  })
})
