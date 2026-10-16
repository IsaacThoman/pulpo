import { describe, expect, it, vi } from 'vitest'
import { createResponseOwnerResolver, FULL_STATE_INVALIDATION_SCOPES, realtimeResourceId, socketSessionToken } from './socket.js'

describe('response owner cache', () => {
  const owner = { userId: 'user', chatId: 'chat' }

  it('shares concurrent lookups and reuses resolved owners', async () => {
    const load = vi.fn(async () => owner)
    const resolve = createResponseOwnerResolver(load)
    const first = resolve('response')
    expect(resolve('response')).toBe(first)
    await expect(first).resolves.toEqual(owner)
    await expect(resolve('response')).resolves.toEqual(owner)
    expect(load).toHaveBeenCalledOnce()
  })

  it('evicts the least recently used response while preserving hot entries', async () => {
    const load = vi.fn(async () => owner)
    const resolve = createResponseOwnerResolver(load, { maxEntries: 2 })
    await resolve('first')
    await resolve('second')
    await resolve('first')
    await resolve('third')
    await resolve('first')
    expect(load).toHaveBeenCalledTimes(3)
    await resolve('second')
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('refreshes expired owners even when they are frequently accessed', async () => {
    let now = 0
    const load = vi.fn(async () => owner)
    const resolve = createResponseOwnerResolver(load, { ttlMs: 100, now: () => now })
    await resolve('response')
    now = 99
    await resolve('response')
    expect(load).toHaveBeenCalledOnce()
    now = 100
    await resolve('response')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries failed and missing lookups', async () => {
    const load = vi.fn<(id: string) => Promise<typeof owner | undefined>>()
      .mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(undefined).mockResolvedValue(owner)
    const resolve = createResponseOwnerResolver(load)
    await expect(resolve('response')).rejects.toThrow('database unavailable')
    await expect(resolve('response')).resolves.toBeUndefined()
    await expect(resolve('response')).resolves.toEqual(owner)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not let an evicted pending lookup remove its replacement', async () => {
    let finish!: (value: typeof owner | undefined) => void
    const load = vi.fn<(id: string) => Promise<typeof owner | undefined>>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValue(owner)
    const resolve = createResponseOwnerResolver(load, { maxEntries: 1 })
    const old = resolve('response')
    await resolve('other')
    const replacement = resolve('response')
    await replacement
    finish(undefined)
    await old
    expect(resolve('response')).toBe(replacement)
    expect(load).toHaveBeenCalledTimes(3)
  })
})

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

describe('reconnect invalidation', () => {
  it('refreshes folder metadata after a missed account revision', () => {
    expect(FULL_STATE_INVALIDATION_SCOPES).toContain('folders')
  })
})
