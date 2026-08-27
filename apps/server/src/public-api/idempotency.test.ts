import { describe, expect, it } from 'vitest'
import { publicIdempotencyScope, publicRequestFingerprint } from './idempotency.js'

describe('public API idempotency', () => {
  it('canonicalizes request object key ordering', () => {
    expect(publicRequestFingerprint({ model: 'm', input: { b: 2, a: 1 } }))
      .toBe(publicRequestFingerprint({ input: { a: 1, b: 2 }, model: 'm' }))
    expect(publicRequestFingerprint({ model: 'm', input: 'one' }))
      .not.toBe(publicRequestFingerprint({ model: 'm', input: 'two' }))
  })

  it('namespaces keys by API key and protocol', () => {
    expect(new Set([
      publicIdempotencyScope('key-a', 'responses'),
      publicIdempotencyScope('key-a', 'chat_completions'),
      publicIdempotencyScope('key-a', 'completions'),
      publicIdempotencyScope('key-b', 'responses'),
    ])).toHaveLength(4)
  })
})
