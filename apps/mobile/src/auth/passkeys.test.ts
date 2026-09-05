import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ supported: vi.fn(() => true) }))

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { passkeyDomains: ['pulpo.baby', 'chat.example.com'] } } },
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { BASE64: 'base64' },
  getRandomBytesAsync: vi.fn(), digestStringAsync: vi.fn(),
}))
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }))
vi.mock('react-native-passkeys', () => ({ isSupported: mocks.supported, create: vi.fn(), get: vi.fn() }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { canUseNativePasskeys, PasskeyCancelledError, validatePasskeyCallback } from './passkeys'

beforeEach(() => { mocks.supported.mockReturnValue(true); (Platform as { OS: string }).OS = 'ios' })

describe('native passkey domain selection', () => {
  it('uses native support only for compiled standard HTTPS domains', () => {
    expect(canUseNativePasskeys('https://pulpo.baby')).toBe(true)
    expect(canUseNativePasskeys('https://chat.example.com/path')).toBe(true)
    expect(canUseNativePasskeys('https://custom.example.com')).toBe(false)
    expect(canUseNativePasskeys('http://pulpo.baby')).toBe(false)
    expect(canUseNativePasskeys('https://pulpo.baby:8443')).toBe(false)
  })

  it('uses Credential Manager only for explicitly configured Android domains', () => {
    (Platform as { OS: string }).OS = 'android'
    expect(canUseNativePasskeys('https://pulpo.baby')).toBe(false)
    Constants.expoConfig!.extra!.androidPasskeyDomains = ['chat.example.com']
    expect(canUseNativePasskeys('https://chat.example.com')).toBe(true)
    expect(canUseNativePasskeys('http://chat.example.com')).toBe(false)
    expect(canUseNativePasskeys('https://chat.example.com:8443')).toBe(false)
    delete Constants.expoConfig!.extra!.androidPasskeyDomains
  })

  it('falls back when the native API is unavailable', () => {
    mocks.supported.mockReturnValue(false)
    expect(canUseNativePasskeys('https://pulpo.baby')).toBe(false)
  })
})

describe('passkey callback validation', () => {
  const state = 'state-value-that-is-at-least-thirty-two-characters'

  it('accepts only the fixed scheme, host, path, and matching state', () => {
    const parameters = validatePasskeyCallback(`pulpo://auth/passkey?state=${state}&code=one-time-code`, '/passkey', state)
    expect(parameters.get('code')).toBe('one-time-code')
    expect(() => validatePasskeyCallback(`https://evil.test/passkey?state=${state}`, '/passkey', state)).toThrow(/did not come from Pulpo/)
    expect(() => validatePasskeyCallback('pulpo://auth/passkey?state=wrong', '/passkey', state)).toThrow(/state did not match/)
  })

  it('treats an explicit browser denial as cancellation', () => {
    expect(() => validatePasskeyCallback(`pulpo://auth/passkey?state=${state}&error=access_denied`, '/passkey', state))
      .toThrow(PasskeyCancelledError)
  })
})
