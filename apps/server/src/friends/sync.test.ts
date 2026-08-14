import { describe, expect, it } from 'vitest'
import { friendPeerIdsFromRows } from './sync.js'

describe('friend state synchronization', () => {
  it('finds and deduplicates peers regardless of pair position', () => {
    expect(friendPeerIdsFromRows([
      { userAId: 'current', userBId: 'first' },
      { userAId: 'second', userBId: 'current' },
      { userAId: 'current', userBId: 'first' },
    ], 'current')).toEqual(['first', 'second'])
  })
})
