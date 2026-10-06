import { verify, X509Certificate } from 'node:crypto'

// Apple Root CA - G3 from https://www.apple.com/certificateauthority/, SHA-256 fingerprint
// 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79.
// The App Store signs transactions, renewal info, and server notifications with a chain to this root.
export const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`

// Apple marks the App Store signing chain with these extensions. Checking them keeps a
// certificate Apple issued for another purpose, such as an Apple Pay merchant certificate
// whose key a developer holds, from signing App Store data.
const APP_STORE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1'
const APP_STORE_LEAF_OID = '1.2.840.113635.100.6.11.1'

const MAX_SIGNED_PAYLOAD_LENGTH = 64 * 1024
const BASE64URL = /^[A-Za-z0-9_-]+$/

let appleRoots: X509Certificate[] | undefined

export class AppStoreSignatureError extends Error {
  override name = 'AppStoreSignatureError'
}

type Tlv = { tag: number; contentStart: number; end: number }

function readTlv(der: Buffer, offset: number, limit: number): Tlv {
  if (offset + 2 > limit) throw new AppStoreSignatureError('Truncated certificate')
  const tag = der[offset]!
  let length = der[offset + 1]!
  let contentStart = offset + 2
  if (length & 0x80) {
    const lengthBytes = length & 0x7f
    if (lengthBytes < 1 || lengthBytes > 4 || contentStart + lengthBytes > limit) throw new AppStoreSignatureError('Invalid certificate length')
    length = 0
    for (let index = 0; index < lengthBytes; index++) length = length * 256 + der[contentStart++]!
  }
  const end = contentStart + length
  if (end > limit) throw new AppStoreSignatureError('Truncated certificate')
  return { tag, contentStart, end }
}

function children(der: Buffer, parent: Tlv): Tlv[] {
  const items: Tlv[] = []
  for (let offset = parent.contentStart; offset < parent.end;) {
    const item = readTlv(der, offset, parent.end)
    items.push(item)
    offset = item.end
  }
  return items
}

function decodeOid(bytes: Buffer): string {
  const first = bytes[0] ?? 0
  const arcs = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80]
  let value = 0
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) {
      arcs.push(value)
      value = 0
    }
  }
  return arcs.join('.')
}

/** Object identifiers of a certificate's X.509 v3 extensions. */
export function certificateExtensionOids(certificate: X509Certificate): string[] {
  const der = certificate.raw
  const root = readTlv(der, 0, der.length)
  const tbs = children(der, root)[0]
  if (!tbs) throw new AppStoreSignatureError('Certificate has no body')
  // Extensions are the explicitly tagged [3] field of TBSCertificate.
  const extensions = children(der, tbs).find((item) => item.tag === 0xa3)
  if (!extensions) return []
  const sequence = children(der, extensions)[0]
  if (!sequence) return []
  return children(der, sequence).flatMap((extension) => {
    const oid = children(der, extension)[0]
    return oid?.tag === 0x06 ? [decodeOid(der.subarray(oid.contentStart, oid.end))] : []
  })
}

function decodeSegment(segment: string): Buffer {
  if (!BASE64URL.test(segment)) throw new AppStoreSignatureError('Signed payload is not base64url encoded')
  return Buffer.from(segment, 'base64url')
}

function parseJson(buffer: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(buffer.toString('utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // Reported below.
  }
  throw new AppStoreSignatureError('Signed payload is not a JSON object')
}

function validAt(certificate: X509Certificate, at: Date): boolean {
  return Date.parse(certificate.validFrom) <= at.getTime() && at.getTime() <= Date.parse(certificate.validTo)
}

function trustedAppleRoots(): X509Certificate[] {
  appleRoots ??= [new X509Certificate(APPLE_ROOT_CA_G3_PEM)]
  return appleRoots
}

/**
 * Verifies an App Store JWS (a transaction, renewal info, or server notification) and
 * returns its payload. The signature must chain to a trusted root through certificates
 * carrying Apple's App Store markers, valid when Apple signed the payload. The chain's
 * own root is ignored in favor of the pinned roots.
 */
export function verifyAppStoreSignedPayload(
  signedPayload: string,
  options: { trustedRoots?: X509Certificate[] } = {},
): Record<string, unknown> {
  if (typeof signedPayload !== 'string' || signedPayload.length > MAX_SIGNED_PAYLOAD_LENGTH) {
    throw new AppStoreSignatureError('Signed payload is missing or too large')
  }
  const segments = signedPayload.split('.')
  if (segments.length !== 3) throw new AppStoreSignatureError('Signed payload is not a compact JWS')
  const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string]
  const header = parseJson(decodeSegment(encodedHeader))
  const payload = parseJson(decodeSegment(encodedPayload))
  const signature = decodeSegment(encodedSignature)
  if (header.alg !== 'ES256') throw new AppStoreSignatureError('Unsupported signing algorithm')
  const chain = header.x5c
  if (!Array.isArray(chain) || chain.length !== 3 || !chain.every((item) => typeof item === 'string')) {
    throw new AppStoreSignatureError('Signed payload has an invalid certificate chain')
  }

  let leaf: X509Certificate
  let intermediate: X509Certificate
  try {
    leaf = new X509Certificate(Buffer.from(chain[0] as string, 'base64'))
    intermediate = new X509Certificate(Buffer.from(chain[1] as string, 'base64'))
  } catch {
    throw new AppStoreSignatureError('Signed payload has an unreadable certificate')
  }
  const signedAt = typeof payload.signedDate === 'number' && Number.isFinite(payload.signedDate)
    ? new Date(payload.signedDate)
    : new Date()
  const roots = options.trustedRoots ?? trustedAppleRoots()
  const root = roots.find((candidate) => intermediate.checkIssued(candidate) && intermediate.verify(candidate.publicKey))
  if (!root) throw new AppStoreSignatureError('Signed payload does not chain to a trusted root')
  if (!intermediate.ca || leaf.ca) throw new AppStoreSignatureError('Signed payload has an invalid certificate chain')
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) {
    throw new AppStoreSignatureError('Signed payload has an invalid certificate chain')
  }
  if (![leaf, intermediate, root].every((certificate) => validAt(certificate, signedAt))) {
    throw new AppStoreSignatureError('Signed payload certificate was not valid when it was signed')
  }
  if (!certificateExtensionOids(intermediate).includes(APP_STORE_INTERMEDIATE_OID)
    || !certificateExtensionOids(leaf).includes(APP_STORE_LEAF_OID)) {
    throw new AppStoreSignatureError('Signed payload was not signed by the App Store')
  }
  const signedData = Buffer.from(`${encodedHeader}.${encodedPayload}`)
  if (signature.length !== 64 || !verify('sha256', signedData, { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, signature)) {
    throw new AppStoreSignatureError('Signed payload signature is invalid')
  }
  return payload
}
