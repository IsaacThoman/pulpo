import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, hashToken, randomToken, safeEqual } from './crypto.js'

describe('secret utilities', () => {
  it('encrypts authenticated secrets', () => {
    const encrypted = encryptSecret('sk-test-secret', 'a sufficiently long deployment master key')
    expect(encrypted).not.toContain('sk-test-secret')
    expect(decryptSecret(encrypted, 'a sufficiently long deployment master key')).toBe('sk-test-secret')
    expect(() => decryptSecret(encrypted, 'the wrong deployment master key')).toThrow()
  })

  it('creates stable hashes and safe comparisons', () => {
    expect(hashToken('token')).toBe(hashToken('token'))
    expect(randomToken()).not.toBe(randomToken())
    expect(safeEqual('same', 'same')).toBe(true)
    expect(safeEqual('same', 'different')).toBe(false)
  })
})
