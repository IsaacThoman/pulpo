import { describe, expect, it, vi } from 'vitest'

vi.mock('./doc-store.js', () => ({ appendDocUpdate: vi.fn(), loadDocUpdate: vi.fn(), MAX_DOC_UPDATE_BYTES: 1_000_000 }))
vi.mock('./request.js', () => ({ filesFeatureEnabled: vi.fn() }))
vi.mock('../database/client.js', () => ({ db: {} }))

const { TokenBucket } = await import('./doc-socket.js')

describe('document socket budget', () => {
  it('allows a burst, then refills with time', () => {
    let now = 0
    const bucket = new TokenBucket(2, 100, 1, () => now)
    expect(bucket.take(10)).toBe(true)
    expect(bucket.take(10)).toBe(true)
    expect(bucket.take(10)).toBe(false)
    now = 500
    expect(bucket.take(10)).toBe(true)
  })

  it('limits bytes independently of message count', () => {
    let now = 0
    const bucket = new TokenBucket(100, 1_000, 1, () => now)
    expect(bucket.take(900)).toBe(true)
    expect(bucket.take(200)).toBe(false)
    now = 200
    expect(bucket.take(200)).toBe(true)
  })
})
