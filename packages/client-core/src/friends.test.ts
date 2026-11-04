import { describe, expect, it } from 'vitest'
import type { FriendConnection, FriendProfile, FriendsList, PoolSummary } from '@pulpo/contracts'
import {
  canInviteToPool,
  friendRequestAge,
  friendSearchErrorMessage,
  friendSearchHighlight,
  friendsOverview,
  nextFriendSearchIndex,
  normalizedFriendSearchQuery,
  shouldSearchFriends,
} from './friends.js'

describe('friend search UI helpers', () => {
  it('normalizes pasted usernames without removing display-name spaces', () => {
    expect(normalizedFriendSearchQuery('  @IsaacThoman ')).toBe('isaacthoman')
    expect(normalizedFriendSearchQuery(' Isaac Thomas ')).toBe('isaac thomas')
    expect(shouldSearchFriends('ab')).toBe(false)
    expect(shouldSearchFriends('@abc')).toBe(true)
  })

  it('highlights case-insensitive substring matches without changing text', () => {
    expect(friendSearchHighlight('Isaac Thomas', 'THOM')).toEqual([
      { text: 'Isaac ', match: false },
      { text: 'Thom', match: true },
      { text: 'as', match: false },
    ])
    expect(friendSearchHighlight('Isaac Thomas', 'isacc')).toEqual([{ text: 'Isaac Thomas', match: false }])
  })

  it('wraps keyboard selection through the result list', () => {
    expect(nextFriendSearchIndex(-1, 1, 3)).toBe(0)
    expect(nextFriendSearchIndex(0, -1, 3)).toBe(2)
    expect(nextFriendSearchIndex(2, 1, 3)).toBe(0)
    expect(nextFriendSearchIndex(0, 1, 0)).toBe(-1)
  })

  it('explains rate limits and lost connections', () => {
    expect(friendSearchErrorMessage({ status: 429 })).toMatch(/Too many searches/)
    expect(friendSearchErrorMessage({ network: true })).toMatch(/offline/)
    expect(friendSearchErrorMessage({ status: 500 })).toBe('Could not search for friends. Try again.')
  })
})

describe('friend request age', () => {
  const now = Date.parse('2026-08-13T18:00:00.000Z')

  it('uses concise relative labels for recent requests', () => {
    expect(friendRequestAge('2026-08-13T10:00:00.000Z', now)).toBe('today')
    expect(friendRequestAge('2026-08-12T10:00:00.000Z', now)).toBe('yesterday')
    expect(friendRequestAge('2026-08-10T10:00:00.000Z', now)).toBe('3 days ago')
    expect(friendRequestAge('2026-08-01T10:00:00.000Z', now, 'en-US')).toBe('Aug 1')
  })

  it('safely omits invalid dates', () => {
    expect(friendRequestAge('not-a-date', now)).toBe('')
  })
})

describe('friends overview', () => {
  const profile = (id: string): FriendProfile => ({ id, displayName: id, username: id.toLowerCase(), avatarUrl: null, profileColor: null })
  const connection = (id: string): FriendConnection => ({ requestId: `request-${id}`, profile: profile(id), requestedAt: '2026-09-01T00:00:00.000Z', acceptedAt: '2026-09-01T00:00:00.000Z' })
  const list: FriendsList = { friends: ['Alice', 'Bob', 'Cara'].map(connection), incoming: [], outgoing: [], blocked: [] }
  const pool = (ownerUserId: string, members: string[], invited: string[] = []): PoolSummary => ({
    accountBalanceMicros: 0,
    incomingInvitations: [],
    pool: {
      id: 'pool',
      ownerUserId,
      pooledBalanceMicros: 0,
      sharedUsage: null,
      members: members.map((id) => ({ profile: profile(id), owner: id === ownerUserId, contributionBalanceMicros: 0, reservedMicros: 0, joinedAt: '2026-09-01T00:00:00.000Z' })),
      pendingInvitations: invited.map((id) => ({ id: `invite-${id}`, poolId: 'pool', inviter: profile(ownerUserId), invitee: profile(id), memberCount: members.length, createdAt: '2026-09-01T00:00:00.000Z' })),
    },
  })

  it('lists Pool members with the Pool instead of with friends', () => {
    const overview = friendsOverview(list, pool('me', ['me', 'Alice'], ['Bob']), 'me')
    expect(overview.friends.map((friend) => friend.profile.id)).toEqual(['Bob', 'Cara'])
    expect([...overview.invitedIds]).toEqual(['Bob'])
    expect(overview.friendIds.has('Alice')).toBe(true)
    expect(overview.isOwner).toBe(true)
    expect(overview.mustTransfer).toBe(true)
  })

  it('lets anyone without a Pool invite, which creates one', () => {
    const overview = friendsOverview(list, { accountBalanceMicros: 0, pool: null, incomingInvitations: [] }, 'me')
    expect(overview.canInvite).toBe(true)
    expect(overview.mustTransfer).toBe(false)
    expect(canInviteToPool(overview, undefined, profile('Cara'))).toBe(true)
  })

  it('offers no invitations before the Pool loads, to members, or from a Pool someone else owns', () => {
    expect(friendsOverview(list, undefined, 'me').canInvite).toBe(false)
    const owned = pool('me', ['me', 'Alice'], ['Bob'])
    const overview = friendsOverview(list, owned, 'me')
    expect(canInviteToPool(overview, owned, profile('Alice'))).toBe(false)
    expect(canInviteToPool(overview, owned, profile('Bob'))).toBe(false)
    expect(canInviteToPool(overview, owned, profile('Cara'))).toBe(true)
    expect(canInviteToPool(overview, owned, profile('Stranger'))).toBe(false)
    expect(friendsOverview(list, pool('Alice', ['Alice', 'me']), 'me').canInvite).toBe(false)
  })

  it('treats pending invitations as taken seats', () => {
    const full = pool('me', ['me', 'Alice'], ['Bob', 'C', 'D', 'E'])
    const overview = friendsOverview(list, full, 'me')
    expect(overview.poolFull).toBe(true)
    expect(canInviteToPool(overview, full, profile('Cara'))).toBe(false)
  })
})
