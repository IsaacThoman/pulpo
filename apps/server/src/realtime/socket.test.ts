import { describe, expect, it } from 'vitest'
import { socketSessionToken } from './socket.js'

describe('Socket.IO session transport', () => {
  it('prefers an explicit native token and preserves cookie fallback', () => {
    const native = 'n'.repeat(43)
    const cookie = 'c'.repeat(43)
    expect(socketSessionToken({ sessionToken: native }, `pulpo_session=${cookie}`, 'pulpo_session')).toBe(native)
    expect(socketSessionToken({}, `other=x; pulpo_session=${cookie}`, 'pulpo_session')).toBe(cookie)
  })

  it('rejects malformed handshake auth instead of stringifying it', () => {
    expect(socketSessionToken({ sessionToken: { token: 'secret' } }, undefined, 'pulpo_session')).toBeUndefined()
  })
})
