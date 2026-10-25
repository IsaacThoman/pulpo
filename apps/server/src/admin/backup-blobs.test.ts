import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { blobLockTarget, sha256Hex } from './backup-blobs.js'
import { wholeSecondLock } from './backup-retention.js'

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
  const day = 86_400_000
  const lockedUntil = new Date('2026-12-01T00:00:00.000Z')
  const after = (ms: number) => new Date(lockedUntil.getTime() + ms)

  it('extends at most a week past the snapshot lock', () => {
    expect(blobLockTarget(lockedUntil, 30 * day)).toEqual(after(7 * day))
  })

  it('never more than doubles a short retention', () => {
    expect(blobLockTarget(lockedUntil, day)).toEqual(after(day))
  })

  it('rounds up to the whole second that Object Lock stores', () => {
    const precise = new Date('2026-12-01T00:00:00.321Z')
    expect(blobLockTarget(precise, 0)).toEqual(new Date('2026-12-01T00:00:01.000Z'))
    expect(wholeSecondLock(lockedUntil)).toEqual(lockedUntil)
  })
})
