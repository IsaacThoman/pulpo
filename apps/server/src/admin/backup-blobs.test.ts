import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { blobLockTarget, sha256Hex } from './backup-blobs.js'

describe('offsite blob identity', () => {
  it('normalizes every stored SHA-256 encoding to lowercase hex', () => {
    const hash = createHash('sha256').update('blob')
    const hex = hash.copy().digest('hex')
    expect(sha256Hex(hex.toUpperCase())).toBe(hex)
    expect(sha256Hex(hash.copy().digest('base64url'))).toBe(hex)
    expect(sha256Hex(hash.copy().digest('base64'))).toBe(hex)
  })

  it('treats missing or foreign digests as unknown so the content is hashed', () => {
    for (const value of [null, undefined, '', 'md5:abc', createHash('sha1').update('blob').digest('hex')]) expect(sha256Hex(value)).toBeNull()
  })
})

describe('offsite blob lock target', () => {
  const now = new Date('2026-11-01T00:00:00.000Z')
  const days = (count: number) => new Date(now.getTime() + count * 86_400_000)

  it('extends at most a week past the snapshot lock', () => {
    expect(blobLockTarget(days(30), now)).toEqual(days(37))
  })

  it('never more than doubles a short retention', () => {
    expect(blobLockTarget(days(1), now)).toEqual(days(2))
    expect(blobLockTarget(now, now)).toEqual(now)
  })
})
