import { describe, expect, it } from 'vitest'
import { generateInviteCode, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode } from './codes.js'

describe('invite codes', () => {
  it('generates 6-character uppercase alphanumeric codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()))
    expect(codes.size).toBe(20)
    for (const code of codes) {
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      expect([...code].every((character) => INVITE_CODE_ALPHABET.includes(character))).toBe(true)
    }
  })

  it('normalizes codes case-insensitively and rejects invalid input', () => {
    expect(normalizeInviteCode(' ab12cd ')).toBe('AB12CD')
    expect(normalizeInviteCode('zz9k2p')).toBe('ZZ9K2P')
    expect(normalizeInviteCode('short')).toBeNull()
    expect(normalizeInviteCode('TOOLONG1')).toBeNull()
    expect(normalizeInviteCode('AB12C!')).toBeNull()
  })
})
