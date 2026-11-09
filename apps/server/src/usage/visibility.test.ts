import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UsageVisibility } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  membership: vi.fn(),
  poolPeers: vi.fn(),
}))
vi.mock('../database/client.js', () => ({
  db: { select: mocks.select, transaction: async (callback: (tx: unknown) => unknown) => callback({}) },
}))
vi.mock('../pools/service.js', () => ({ activePoolMembership: mocks.membership, poolPeerIds: mocks.poolPeers }))
import { canViewUsage, usageAccess, visibleFriendUsageCircle } from './visibility.js'

function result(rows: unknown[]) {
  const query = {
    from: () => query, where: () => query, limit: () => query,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  }
  return query
}

function pools(byUser: Record<string, string>) {
  mocks.membership.mockImplementation(async (_tx: unknown, userId: string) => (
    byUser[userId] ? { pool: { id: byUser[userId] }, member: {} } : null
  ))
}

beforeEach(() => {
  vi.resetAllMocks()
  pools({})
  mocks.poolPeers.mockResolvedValue([])
})

describe('canViewUsage', () => {
  const relations = {
    stranger: { self: false, friends: false, sharesPool: false },
    friend: { self: false, friends: true, sharesPool: false },
    poolMember: { self: false, friends: false, sharesPool: true },
    friendInPool: { self: false, friends: true, sharesPool: true },
  }
  const expected: Record<UsageVisibility, Record<keyof typeof relations, boolean>> = {
    pool: { stranger: false, friend: false, poolMember: true, friendInPool: true },
    friends: { stranger: false, friend: true, poolMember: true, friendInPool: true },
    public: { stranger: true, friend: true, poolMember: true, friendInPool: true },
  }

  for (const [visibility, outcomes] of Object.entries(expected) as [UsageVisibility, Record<keyof typeof relations, boolean>][]) {
    for (const [name, relation] of Object.entries(relations) as [keyof typeof relations, typeof relations.stranger][]) {
      it(`${outcomes[name] ? 'shows' : 'hides'} ${visibility} usage to a ${name}`, () => {
        expect(canViewUsage(visibility, relation)).toBe(outcomes[name])
      })
    }
    it(`always shows ${visibility} usage to its owner`, () => {
      for (const friends of [false, true]) for (const sharesPool of [false, true]) {
        expect(canViewUsage(visibility, { self: true, friends, sharesPool })).toBe(true)
      }
    })
  }

  it('nests public over friends over pool', () => {
    for (const relation of Object.values(relations)) {
      if (canViewUsage('pool', relation)) expect(canViewUsage('friends', relation)).toBe(true)
      if (canViewUsage('friends', relation)) expect(canViewUsage('public', relation)).toBe(true)
    }
  })
})

describe('usageAccess', () => {
  it('allows the owner and public profiles without any lookups', async () => {
    await expect(usageAccess('me', { id: 'me', usageVisibility: 'pool' })).resolves.toBe(true)
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'public' })).resolves.toBe(true)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.membership).not.toHaveBeenCalled()
  })

  it('allows accepted friends at the friends level', async () => {
    mocks.select.mockReturnValueOnce(result([{ id: 'friendship' }]))
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'friends' })).resolves.toBe(true)
    expect(mocks.membership).not.toHaveBeenCalled()
  })

  it('uses a known friendship instead of querying it', async () => {
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'friends' }, { friends: true })).resolves.toBe(true)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('falls back to a shared active Pool for non-friends', async () => {
    mocks.select.mockReturnValueOnce(result([]))
    pools({ me: 'pool-1', other: 'pool-1' })
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'friends' })).resolves.toBe(true)
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'pool' })).resolves.toBe(true)
  })

  it('hides pool-only usage from friends outside the Pool', async () => {
    pools({ me: 'pool-1', other: 'pool-2' })
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'pool' }, { friends: true })).resolves.toBe(false)
    pools({ other: 'pool-2' })
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'pool' })).resolves.toBe(false)
    // The friendship is irrelevant at the pool level, so it is never looked up.
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('hides friends-level usage from strangers outside the Pool', async () => {
    mocks.select.mockReturnValueOnce(result([]))
    await expect(usageAccess('me', { id: 'other', usageVisibility: 'friends' })).resolves.toBe(false)
  })
})

describe('visibleFriendUsageCircle', () => {
  it('keeps everyone when no friend limits usage to their Pool', async () => {
    mocks.select.mockReturnValueOnce(result([]))
    await expect(visibleFriendUsageCircle('me', ['me', 'a', 'b'])).resolves.toEqual(['me', 'a', 'b'])
    expect(mocks.poolPeers).not.toHaveBeenCalled()
  })

  it('skips the lookup when the circle is only the viewer', async () => {
    await expect(visibleFriendUsageCircle('me', ['me'])).resolves.toEqual(['me'])
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('drops pool-only friends unless they share the viewer\'s Pool', async () => {
    mocks.select.mockReturnValueOnce(result([{ id: 'b', usageVisibility: 'pool' }, { id: 'c', usageVisibility: 'pool' }]))
    mocks.poolPeers.mockResolvedValueOnce(['c', 'stranger'])
    await expect(visibleFriendUsageCircle('me', ['me', 'a', 'b', 'c'])).resolves.toEqual(['me', 'a', 'c'])
    expect(mocks.poolPeers).toHaveBeenCalledWith({}, 'me')
  })
})
