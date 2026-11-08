import { describe, expect, it } from 'vitest'
import { friendNetworkIds, friendPeerIdsFromRows } from './sync.js'

describe('friend state synchronization', () => {
  it('finds and deduplicates peers regardless of pair position', () => {
    expect(friendPeerIdsFromRows([
      { userAId: 'current', userBId: 'first' },
      { userAId: 'second', userBId: 'current' },
      { userAId: 'current', userBId: 'first' },
    ], 'current')).toEqual(['first', 'second'])
  })

  it('expands a friendship change to both participants and their accepted friends', async () => {
    const acceptedRowsByCall = [
      [{ userAId: 'a', userBId: 'b' }, { userAId: 'a', userBId: 'friend-of-a' }],
      [{ userAId: 'a', userBId: 'b' }, { userAId: 'friend-of-b', userBId: 'b' }, { userAId: 'b', userBId: 'friend-of-a' }],
    ]
    let call = 0
    const transaction = {
      select: () => ({ from: () => ({ where: async () => acceptedRowsByCall[call++] ?? [] }) }),
    } as unknown as Parameters<typeof friendNetworkIds>[0]

    expect(await friendNetworkIds(transaction, ['a', 'b'])).toEqual(['a', 'b', 'friend-of-a', 'friend-of-b'])
    expect(call).toBe(2)
  })
})
