import { describe, expect, it } from 'vitest'
import { androidAssetLinks, androidCertificateFingerprints, androidPasskeyOrigins, passkeyVerificationOrigins } from './android-app.js'
const fingerprint = '12'.repeat(32)
describe('Android app identity', () => {
  it('normalizes and deduplicates only valid SHA-256 certificates', () => {
    const normalized = Array(32).fill('12').join(':')
    expect(androidCertificateFingerprints(` ${fingerprint},${normalized}`)).toEqual([normalized])
    expect(() => androidCertificateFingerprints('not-a-certificate')).toThrow(/SHA-256/)
    expect(androidAssetLinks('')).toEqual([])
  })
  it('publishes the fixed app identity and matches Credential Manager origins', () => {
    expect(androidPasskeyOrigins(fingerprint)).toEqual([`android:apk-key-hash:${Buffer.alloc(32, 0x12).toString('base64url')}`])
    expect(androidAssetLinks(fingerprint)[0]?.target.package_name).toBe('com.isaacthoman.pulpo')
  })
  it('allows configured app origins only for native ceremonies', () => {
    const origin = 'https://pulpo.example'
    expect(passkeyVerificationOrigins('native-authentication', origin, fingerprint)).toEqual([origin, ...androidPasskeyOrigins(fingerprint)])
    expect(passkeyVerificationOrigins('native-registration', origin, '')).toEqual([origin])
    expect(passkeyVerificationOrigins('web-authentication', origin, fingerprint)).toBe(origin)
    expect(passkeyVerificationOrigins('browser-registration', origin, fingerprint)).toBe(origin)
  })
})
