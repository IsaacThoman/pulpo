import { readFileSync } from 'node:fs'
import { createPrivateKey, sign, X509Certificate } from 'node:crypto'

// Test-only signing for App Store payloads. See README.md in this directory.
function fixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
}

function der(pem: string): string {
  return new X509Certificate(pem).raw.toString('base64')
}

export const testAppStoreRoot = new X509Certificate(fixture('test-root.pem'))

export function signTestAppStorePayload(
  payload: Record<string, unknown>,
  options: { unmarkedLeaf?: boolean; header?: Record<string, unknown> } = {},
): string {
  const leaf = options.unmarkedLeaf ? 'test-unmarked-leaf' : 'test-leaf'
  const header = {
    alg: 'ES256',
    x5c: [der(fixture(`${leaf}.pem`)), der(fixture('test-intermediate.pem')), der(fixture('test-root.pem'))],
    ...options.header,
  }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`), {
    key: createPrivateKey(fixture(`${leaf}-key.pem`)),
    dsaEncoding: 'ieee-p1363',
  })
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`
}
