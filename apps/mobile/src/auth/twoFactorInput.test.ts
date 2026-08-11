import { describe, expect, it } from 'vitest'
import {
  isValidAuthenticatorCode,
  isValidRecoveryCode,
  isValidSecondFactorCode,
  normalizeAuthenticatorCode,
  normalizeRecoveryCodeInput,
  normalizeSecondFactorCode,
} from './twoFactorInput'

describe('two-factor code input', () => {
  it('keeps only the first six authenticator digits', () => {
    expect(normalizeAuthenticatorCode('12 3a45-678')).toBe('123456')
    expect(isValidAuthenticatorCode('123456')).toBe(true)
    expect(isValidAuthenticatorCode('12345')).toBe(false)
  })

  it('normalizes pasted recovery codes into readable groups', () => {
    expect(normalizeRecoveryCodeInput(' abcd efgh-jkmn ')).toBe('ABCD-EFGH-JKMN')
    expect(isValidRecoveryCode('ABCD-EFGH-JKMN')).toBe(true)
  })

  it('rejects ambiguous characters that recovery codes never contain', () => {
    expect(isValidRecoveryCode('ABCI-EFGH-JKMN')).toBe(false)
    expect(isValidRecoveryCode('ABCO-EFGH-JKMN')).toBe(false)
    expect(isValidRecoveryCode('ABC1-EFGH-JKMN')).toBe(false)
  })

  it('accepts either supported second-factor form', () => {
    expect(normalizeSecondFactorCode('123 456')).toBe('123456')
    expect(normalizeSecondFactorCode('abcd efgh jkmn')).toBe('ABCD-EFGH-JKMN')
    expect(isValidSecondFactorCode('123456')).toBe(true)
    expect(isValidSecondFactorCode('ABCD-EFGH-JKMN')).toBe(true)
    expect(isValidSecondFactorCode('12345')).toBe(false)
  })
})
