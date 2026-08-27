import { describe, expect, it } from 'vitest'
import {
  formatChatExpiryRemaining,
  resolveConfiguredChatExpirationPeriod,
  resolveChatExpiryMenuAction,
  resolveChatLandingBadge,
} from './chat-expiration'

describe('chat expiration labels', () => {
  const now = Date.parse('2026-08-10T12:00:00.000Z')

  it('shows only the most significant remaining unit', () => {
    expect(formatChatExpiryRemaining(now + 7 * 24 * 60 * 60_000, now)).toBe('7d')
    expect(formatChatExpiryRemaining(now + ((4 * 24 * 60 + 3 * 60 + 4) * 60_000), now)).toBe('4d')
    expect(formatChatExpiryRemaining(now + (23 * 60 + 40) * 60_000, now)).toBe('23h')
    expect(formatChatExpiryRemaining(now + 40 * 60_000, now)).toBe('40m')
  })

  it('rounds a partial minute up and handles elapsed deadlines', () => {
    expect(formatChatExpiryRemaining(now + 1, now)).toBe('1m')
    expect(formatChatExpiryRemaining(now, now)).toBe('now')
  })

  it('uses the same menu slot to enable or disable expiration', () => {
    expect(resolveChatExpiryMenuAction(null, '24h')).toEqual({ kind: 'enable', label: 'Expire in 24h' })
    expect(resolveChatExpiryMenuAction(null, '7d')).toEqual({ kind: 'enable', label: 'Expire in 7d' })
    expect(resolveChatExpiryMenuAction(null, 'disabled')).toBeNull()
    expect(resolveChatExpiryMenuAction(now + 60_000, 'disabled')).toEqual({ kind: 'disable' })
  })

  it('resolves the empty-chat badge with temporary mode taking priority', () => {
    expect(resolveChatLandingBadge(false, true, '24h')).toEqual({ kind: 'expiration', period: '24h' })
    expect(resolveChatLandingBadge(false, true, '7d')).toEqual({ kind: 'expiration', period: '7d' })
    expect(resolveChatLandingBadge(false, false, '24h')).toBeNull()
    expect(resolveChatLandingBadge(false, true, 'disabled')).toBeNull()
    expect(resolveChatLandingBadge(true, true, '7d')).toEqual({ kind: 'temporary' })
  })

  it('resolves the badge label period from the account configuration', () => {
    expect(resolveConfiguredChatExpirationPeriod('24h')).toBe('24h')
    expect(resolveConfiguredChatExpirationPeriod('7d')).toBe('7d')
    expect(resolveConfiguredChatExpirationPeriod('disabled')).toBeNull()
  })
})
