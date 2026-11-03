import { createPrivateKey, sign, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Signs App Store payloads with the test chain in fixtures/app-store, for tests that verify
 * transactions and notifications the way they arrive from Apple.
 */

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/billing/fixtures/app-store/${name}`, import.meta.url)), 'utf8')
}

const chain = ['test-signing.pem', 'test-intermediate.pem', 'test-root.pem']
  .map((name) => new X509Certificate(fixture(name)).raw.toString('base64'))
const signingKey = createPrivateKey(fixture('test-signing-key.pem'))

export const testAppStoreRoot = Buffer.from(fixture('test-root.pem'))

export function signAppStorePayload(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode({ alg: 'ES256', x5c: chain })}.${encode(payload)}`
  const signature = sign('sha256', Buffer.from(input), { key: signingKey, dsaEncoding: 'ieee-p1363' })
  return `${input}.${signature.toString('base64url')}`
}
