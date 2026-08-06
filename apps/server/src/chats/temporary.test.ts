import { describe, expect, it } from 'vitest'
import {
  TEMPORARY_CHAT_TTL_MS,
  temporaryChatExpiresAt,
  temporaryChatIsExpired,
} from './temporary.js'

describe('temporary chat retention', () => {
  it('sets a 48-hour deadline from the accepted user turn', () => {
    const acceptedAt = new Date('2026-08-05T12:00:00.000Z')
    const expiresAt = temporaryChatExpiresAt(acceptedAt)

    expect(TEMPORARY_CHAT_TTL_MS).toBe(48 * 60 * 60 * 1_000)
    expect(expiresAt.toISOString()).toBe('2026-08-07T12:00:00.000Z')
  })

  it('treats the deadline as a hard boundary while permanent chats never expire', () => {
    const expiresAt = new Date('2026-08-07T12:00:00.000Z')

    expect(temporaryChatIsExpired({ temporary: true, expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(false)
    expect(temporaryChatIsExpired({ temporary: true, expiresAt }, expiresAt)).toBe(true)
    expect(temporaryChatIsExpired({ temporary: true, expiresAt: null }, new Date())).toBe(true)
    expect(temporaryChatIsExpired({ temporary: false, expiresAt }, new Date(expiresAt.getTime() + 1))).toBe(false)
  })
})
