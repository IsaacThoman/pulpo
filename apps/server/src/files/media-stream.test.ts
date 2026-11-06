import { describe, expect, it } from 'vitest'
import { createMediaStreamToken, parseByteRange, verifyMediaStreamToken } from './media-stream.js'

const secret = 'test-secret-that-is-at-least-32-characters'
const claims = { nodeId: 'node-1', userId: 'user-1', objectKey: 'users/user-1/files/object-1', expiresAt: 2_000_000_000 }

describe('media stream tokens', () => {
  it('round-trips its claims', () => {
    const token = createMediaStreamToken(claims, secret)
    expect(verifyMediaStreamToken(token, secret, 1_000)).toEqual(claims)
  })

  it('rejects expired tokens', () => {
    const token = createMediaStreamToken(claims, secret)
    expect(verifyMediaStreamToken(token, secret, claims.expiresAt * 1000)).toBeNull()
  })

  it('rejects tokens signed with another secret or altered claims', () => {
    const token = createMediaStreamToken(claims, secret)
    expect(verifyMediaStreamToken(token, `${secret}-other`, 1_000)).toBeNull()
    const [, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify(['node-2', 'user-1', claims.objectKey, claims.expiresAt])).toString('base64url')
    expect(verifyMediaStreamToken(`${forged}.${signature}`, secret, 1_000)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    for (const token of ['', 'abc', 'a.b.c', `${Buffer.from('{}').toString('base64url')}.x`]) {
      expect(verifyMediaStreamToken(token, secret, 1_000)).toBeNull()
    }
  })
})

describe('parseByteRange', () => {
  it('serves the whole file without a usable single range', () => {
    expect(parseByteRange(undefined, 100)).toBeNull()
    expect(parseByteRange('bytes=-', 100)).toBeNull()
    expect(parseByteRange('bytes=0-10,20-30', 100)).toBeNull()
    expect(parseByteRange('items=0-10', 100)).toBeNull()
    expect(parseByteRange('bytes=10-5', 100)).toBeNull()
  })

  it('reads open, closed, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })

  it('reports ranges past the end', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable')
  })
})
