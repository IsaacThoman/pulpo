import { describe, expect, it } from 'vitest'
import { realtimeResourceId, socketSessionToken } from './socket.js'

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

describe('realtimeResourceId', () => {
  it('accepts UUIDs and rejects optimistic legacy IDs before database queries', () => {
    const id = '4b080a0d-6255-4eaf-8c1e-e1e21f0336ee'
    expect(realtimeResourceId(id)).toBe(id)
    expect(realtimeResourceId('chat-1785795671000')).toBeUndefined()
    expect(realtimeResourceId(undefined)).toBeUndefined()
  })
})
