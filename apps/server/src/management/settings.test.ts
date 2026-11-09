import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    preferences: null as { values: Record<string, unknown> } | null,
    profile: { username: 'pulpo_user', profileColor: null as string | null, usageVisibility: 'friends' },
  },
  updates: [] as Record<string, unknown>[],
  friendPeerIds: vi.fn(),
  poolPeerIds: vi.fn(),
  bumpAccountRevisions: vi.fn(),
  publishScopedStateChanges: vi.fn(),
  publishStateChange: vi.fn(),
}))

vi.mock('../database/client.js', async () => {
  const { applicationSettings, userPreferences, users } = await import('../database/schema.js')
  const rowsFor = (table: unknown) => {
    if (table === userPreferences) return mocks.state.preferences ? [mocks.state.preferences] : []
    if (table === users) return [{ ...mocks.state.profile }]
    if (table === applicationSettings) return []
    return []
  }
  const database = {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          where: () => query,
          limit: async () => rowsFor(table),
          then: (resolve: (rows: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rowsFor(table)).then(resolve, reject),
        }
        return query
      },
    }),
    execute: async () => undefined,
    insert: (table: unknown) => ({
      values: (row: { values?: Record<string, unknown> }) => {
        if (table === userPreferences) mocks.state.preferences = { values: row.values! }
        return Object.assign(Promise.resolve(), { onConflictDoUpdate: async () => undefined })
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values)
        const { username, profileColor, usageVisibility } = values as typeof mocks.state.profile
        Object.assign(mocks.state.profile, { username, profileColor, usageVisibility })
        return { where: () => ({ returning: async () => [{ revision: 9 }] }) }
      },
    }),
    transaction: async (callback: (tx: unknown) => unknown) => callback(database),
  }
  return { db: database }
})
vi.mock('../friends/sync.js', () => ({
  friendPeerIds: mocks.friendPeerIds,
  bumpAccountRevisions: mocks.bumpAccountRevisions,
  publishScopedStateChanges: mocks.publishScopedStateChanges,
}))
vi.mock('../pools/service.js', () => ({ poolPeerIds: mocks.poolPeerIds }))
vi.mock('../responses/events.js', () => ({ publishStateChange: mocks.publishStateChange }))
vi.mock('../jobs.js', () => ({ queueTrashPurge: vi.fn() }))

import { applyManagementSettings, loadManagementSettings, planManagementSettings } from './settings.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updates.length = 0
  mocks.state.preferences = null
  mocks.state.profile = { username: 'pulpo_user', profileColor: null, usageVisibility: 'friends' }
  mocks.friendPeerIds.mockResolvedValue(['friend'])
  mocks.poolPeerIds.mockResolvedValue(['pool-peer'])
  mocks.bumpAccountRevisions.mockImplementation(async (_tx: unknown, ids: string[]) => ids.map((userId) => ({ userId, revision: 3 })))
})

describe('management account usage visibility', () => {
  it('reads usage visibility from the user row rather than stored preferences', async () => {
    mocks.state.preferences = { values: { usageVisibility: 'public', leaderboardVisible: true } }
    mocks.state.profile.usageVisibility = 'pool'
    const document = await loadManagementSettings('me')
    expect(document.account.usageVisibility).toBe('pool')
    expect(document.account.leaderboardVisible).toBe(true)
  })

  it('plans, writes, and publishes a usage visibility change', async () => {
    const current = await loadManagementSettings('me')
    const next = { ...current, account: { ...current.account, usageVisibility: 'public' } }
    expect((await planManagementSettings('me', next, {}, 'account')).changes)
      .toEqual([{ path: 'account.usageVisibility', before: 'friends', after: 'public' }])

    const applied = await applyManagementSettings('me', 'me', next, current.revision, {}, 'account')

    expect(mocks.updates[0]).toMatchObject({ username: 'pulpo_user', profileColor: null, usageVisibility: 'public' })
    expect(applied.account.usageVisibility).toBe('public')
    expect(mocks.publishStateChange).toHaveBeenCalledWith({ userId: 'me', revision: 9 })
    expect(mocks.publishScopedStateChanges).toHaveBeenCalledWith([{ userId: 'friend', revision: 3 }], ['friends'])
    expect(mocks.publishScopedStateChanges).toHaveBeenCalledWith([{ userId: 'pool-peer', revision: 3 }], ['pool'])
  })

  it('does not notify Pool members for unrelated account changes', async () => {
    const current = await loadManagementSettings('me')
    await applyManagementSettings('me', 'me', { ...current, account: { ...current.account, sendWithEnter: false } }, current.revision, {}, 'account')
    expect(mocks.updates[0]).toMatchObject({ usageVisibility: 'friends' })
    expect(mocks.friendPeerIds).not.toHaveBeenCalled()
    expect(mocks.poolPeerIds).not.toHaveBeenCalled()
  })

  it('rejects unknown visibility levels', async () => {
    const current = await loadManagementSettings('me')
    await expect(planManagementSettings('me', { ...current, account: { ...current.account, usageVisibility: 'everyone' } }))
      .rejects.toThrow()
    expect(mocks.updates).toHaveLength(0)
  })
})
