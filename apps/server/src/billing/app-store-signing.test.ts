import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APPLE_ROOT_CA_G3_PEM, AppStoreSignatureError, certificateExtensionOids, verifyAppStoreSignedPayload } from './app-store-signing.js'
import { signTestAppStorePayload, testAppStoreRoot } from './fixtures/app-store/sign.js'

const trustedRoots = [testAppStoreRoot]
const payload = { transactionId: '2000000000000001', signedDate: Date.parse('2026-10-01T00:00:00Z') }

function tamper(jws: string, segment: number, replace: (value: string) => string): string {
  const parts = jws.split('.')
  parts[segment] = replace(parts[segment]!)
  return parts.join('.')
}

describe('App Store signed payload verification', () => {
  it('returns the payload of a correctly signed JWS', () => {
    expect(verifyAppStoreSignedPayload(signTestAppStorePayload(payload), { trustedRoots })).toEqual(payload)
  })

  it('rejects a chain that does not end at a trusted root', () => {
    // The default trust store holds only Apple Root CA - G3.
    expect(() => verifyAppStoreSignedPayload(signTestAppStorePayload(payload)))
      .toThrow('does not chain to a trusted root')
  })

  it('rejects a leaf certificate without the App Store marker', () => {
    expect(() => verifyAppStoreSignedPayload(signTestAppStorePayload(payload, { unmarkedLeaf: true }), { trustedRoots }))
      .toThrow('was not signed by the App Store')
  })

  it('rejects a modified payload', () => {
    const forged = tamper(signTestAppStorePayload(payload), 1, () => Buffer.from(JSON.stringify({ ...payload, transactionId: '1' })).toString('base64url'))
    expect(() => verifyAppStoreSignedPayload(forged, { trustedRoots })).toThrow('signature is invalid')
  })

  it('rejects other algorithms and malformed chains', () => {
    expect(() => verifyAppStoreSignedPayload(signTestAppStorePayload(payload, { header: { alg: 'none' } }), { trustedRoots }))
      .toThrow('Unsupported signing algorithm')
    expect(() => verifyAppStoreSignedPayload(signTestAppStorePayload(payload, { header: { x5c: ['AAAA'] } }), { trustedRoots }))
      .toThrow('invalid certificate chain')
    expect(() => verifyAppStoreSignedPayload('not.a.jws!', { trustedRoots })).toThrow(AppStoreSignatureError)
    expect(() => verifyAppStoreSignedPayload('only.two', { trustedRoots })).toThrow('not a compact JWS')
  })

  it('rejects a payload signed outside the certificate validity period', () => {
    const early = signTestAppStorePayload({ ...payload, signedDate: Date.parse('2019-06-01T00:00:00Z') })
    expect(() => verifyAppStoreSignedPayload(early, { trustedRoots })).toThrow('was not valid when it was signed')
  })

  it('reads certificate extension identifiers', () => {
    const leaf = new X509Certificate(readFileSync(new URL('./fixtures/app-store/test-leaf.pem', import.meta.url)))
    expect(certificateExtensionOids(leaf)).toContain('1.2.840.113635.100.6.11.1')
    expect(certificateExtensionOids(testAppStoreRoot)).not.toContain('1.2.840.113635.100.6.2.1')
  })
})

describe('pinned Apple root', () => {
  it('is Apple Root CA - G3', () => {
    const root = new X509Certificate(APPLE_ROOT_CA_G3_PEM)
    expect(root.subject).toContain('CN=Apple Root CA - G3')
    expect(root.fingerprint256).toBe('63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79')
  })
})
