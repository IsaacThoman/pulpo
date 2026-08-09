import { describe, expect, it } from 'vitest'
import { generateRecoveryCodes, normalizeRecoveryCode, validateTotp } from './two-factor.js'

describe('TOTP verification', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

  it('accepts the RFC 6238 SHA-1 value as six digits and rejects replay', () => {
    expect(validateTotp(rfcSecret, '287082', -1, 59_000)).toBe(1)
    expect(validateTotp(rfcSecret, '287082', 1, 59_000)).toBeNull()
    expect(validateTotp(rfcSecret, '94287082', -1, 59_000)).toBeNull()
  })

  it('accepts one adjacent 30-second period for clock skew', () => {
    expect(validateTotp(rfcSecret, '287082', -1, 89_000)).toBe(1)
    expect(validateTotp(rfcSecret, '287082', -1, 119_000)).toBeNull()
  })
})

describe('two-factor recovery codes', () => {
  it('generates ten unique, normalized, high-entropy codes', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(codes.every((code) => /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code))).toBe(true)
    expect(normalizeRecoveryCode(codes[0]!.toLowerCase().replaceAll('-', ' '))).toBe(codes[0]!.replaceAll('-', ''))
  })
})
