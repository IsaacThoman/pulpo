import Fastify, { type FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagementSettingsDocument, UsageVisibility } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  state: {
    preferences: null as { values: Record<string, unknown> } | null,
    profile: { username: 'pulpo_user', profileColor: null as string | null, usageVisibility: 'friends' as UsageVisibility },
    settings: new Map<string, { key: string; value: unknown; updatedAt: Date }>(),
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
    if (table === applicationSettings) return [...mocks.state.settings.values()]
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
      values: (row: { key?: string; value?: unknown; values?: Record<string, unknown> }) => {
        if (table === userPreferences) mocks.state.preferences = { values: row.values! }
        if (table === applicationSettings) {
          mocks.state.settings.set(row.key!, { key: row.key!, value: row.value, updatedAt: new Date() })
        }
        return Object.assign(Promise.resolve(), {
          onConflictDoUpdate: () => Object.assign(Promise.resolve(), { returning: async () => [row] }),
        })
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
    delete: () => ({ where: async () => undefined }),
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

import { applyManagementSettings, loadManagementSettings, planManagementSettings, withStoredUsageVisibility } from './settings.js'
import { registerManagementRoutes } from './routes.js'
import { registerInstanceColorThemeRoutes } from '../settings/instance-color-themes.js'

/** What a client built before usageVisibility existed sends: the field stripped as unknown. */
function withoutUsageVisibility(document: ManagementSettingsDocument): ManagementSettingsDocument {
  const { usageVisibility: _usageVisibility, ...account } = document.account
  return { ...document, account }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updates.length = 0
  mocks.state.preferences = null
  mocks.state.settings.clear()
  mocks.state.profile = { username: 'pulpo_user', profileColor: null, usageVisibility: 'friends' }
  mocks.friendPeerIds.mockResolvedValue(['friend'])
  mocks.poolPeerIds.mockResolvedValue(['pool-peer'])
  mocks.bumpAccountRevisions.mockImplementation(async (_tx: unknown, ids: string[]) => ids.map((userId) => ({ userId, revision: 3 })))
})

describe('instance color theme settings', () => {
  const input = { id: 'lagoon', name: 'Lagoon', light: { colors: { 'button.background': '#0E7490' } } }

  it('publishes CLI changes for members and rejects an admin editor based on a stale catalog', async () => {
    const app = Fastify()
    app.addHook('preHandler', async (request) => {
      if (!request.headers['test-role']) return
      request.user = { id: 'me', role: request.headers['test-role'], blocked: false } as FastifyRequest['user']
      request.managementTokenId = 'token'
      request.managementScopes = ['instance:read', 'instance:write']
    })
    registerInstanceColorThemeRoutes(app)
    await registerManagementRoutes(app)
    const catalogUrl = '/api/interface/color-themes'
    const editorUrl = '/api/admin/settings/color-themes'
    const cliUrl = '/api/management/v1/settings/instance'
    const admin = { 'test-role': 'admin' }
    const member = { 'test-role': 'user' }
    try {
      expect((await app.inject(catalogUrl)).statusCode).toBe(401)
      const empty = (await app.inject({ url: catalogUrl, headers: member })).json()
      expect(empty.themes).toEqual([])
      const cli = (await app.inject({ url: cliUrl, headers: admin })).json()
      expect(cli.instance.colorThemes).toEqual([])
      const document = { ...cli, instance: { ...cli.instance, colorThemes: [input] } }
      const plan = await app.inject({ method: 'POST', url: `${cliUrl}/plan`, headers: admin, payload: { document } })
      expect(plan.statusCode).toBe(200)
      expect(plan.json().changes.map((change: { path: string }) => change.path)).toEqual(['instance.colorThemes'])
      const applied = await app.inject({
        method: 'POST', url: `${cliUrl}/apply`, headers: admin, payload: { document, revision: plan.json().revision },
      })
      expect(applied.statusCode).toBe(200)
      const published = (await app.inject({ url: catalogUrl, headers: member })).json()
      expect(published.themes).toMatchObject([{ id: 'lagoon', light: { colors: { 'button.background': '#0e7490' } } }])
      expect((await app.inject({ method: 'PUT', url: editorUrl, headers: member, payload: published })).statusCode).toBe(403)
      expect((await app.inject({ method: 'PUT', url: editorUrl, headers: admin, payload: empty })).statusCode).toBe(409)
      const deleted = await app.inject({ method: 'PUT', url: editorUrl, headers: admin, payload: { ...published, themes: [] } })
      expect(deleted.statusCode).toBe(200)
      expect((await app.inject({ url: cliUrl, headers: admin })).json().instance.colorThemes).toEqual([])
    } finally {
      await app.close()
    }
  })

  it('preserves the catalog when an older settings document omits it', async () => {
    const current = await loadManagementSettings('me')
    const { revision, instance } = await applyManagementSettings('me', 'me', {
      ...current, instance: { ...current.instance, colorThemes: [input] },
    }, current.revision, {}, 'instance')
    const { colorThemes: _colorThemes, ...olderInstance } = instance
    const document = { ...current, revision, instance: { ...olderInstance, interface: { ...instance.interface, title: false } } }
    const plan = await planManagementSettings('me', document, {}, 'instance')
    expect(plan.changes.map((change) => change.path)).toEqual(['instance.interface.title'])
    const applied = await applyManagementSettings('me', 'me', document, revision, {}, 'instance')
    expect(applied.instance.colorThemes).toEqual(instance.colorThemes)
  })
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

  it.each(['pool', 'public'] as const)('keeps a stored %s level when an account document omits it', async (stored) => {
    mocks.state.profile.usageVisibility = stored
    const current = await loadManagementSettings('me')
    expect(current.account.usageVisibility).toBe(stored)
    const next = withoutUsageVisibility({ ...current, account: { ...current.account, theme: 'dark' } })
    expect(next.account).not.toHaveProperty('usageVisibility')

    const plan = await planManagementSettings('me', next, {}, 'account')
    expect(plan.changes).toEqual([{ path: 'account.theme', before: 'system', after: 'dark' }])
    expect(plan.document.account.usageVisibility).toBe(stored)

    const applied = await applyManagementSettings('me', 'me', next, current.revision, {}, 'account')
    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0]).toMatchObject({ usageVisibility: stored })
    expect(mocks.state.preferences?.values).toMatchObject({ theme: 'dark', usageVisibility: stored })
    expect(applied.account.usageVisibility).toBe(stored)
    expect(mocks.friendPeerIds).not.toHaveBeenCalled()
    expect(mocks.poolPeerIds).not.toHaveBeenCalled()
  })

  it('keeps the stored level when a full settings document omits it', async () => {
    mocks.state.profile.usageVisibility = 'pool'
    const current = await loadManagementSettings('me')
    const next = withoutUsageVisibility({ ...current, account: { ...current.account, sendWithEnter: false } })
    expect((await planManagementSettings('me', next)).changes)
      .toEqual([{ path: 'account.sendWithEnter', before: true, after: false }])
    await applyManagementSettings('me', 'me', next, current.revision)
    expect(mocks.updates[0]).toMatchObject({ usageVisibility: 'pool' })
    expect(mocks.poolPeerIds).not.toHaveBeenCalled()
  })

  it('treats an untouched document without the field as no change', async () => {
    mocks.state.profile.usageVisibility = 'pool'
    const current = await loadManagementSettings('me')
    const next = withoutUsageVisibility(current)
    expect((await planManagementSettings('me', next, {}, 'account')).changes).toEqual([])
    expect(await applyManagementSettings('me', 'me', next, current.revision, {}, 'account')).toEqual(current)
    expect(mocks.updates).toHaveLength(0)
  })

  it('still applies an explicit level that matches the default', async () => {
    mocks.state.profile.usageVisibility = 'pool'
    const current = await loadManagementSettings('me')
    const next = { ...current, account: { ...current.account, usageVisibility: 'friends' as const } }
    expect((await planManagementSettings('me', next, {}, 'account')).changes)
      .toEqual([{ path: 'account.usageVisibility', before: 'pool', after: 'friends' }])
    await applyManagementSettings('me', 'me', next, current.revision, {}, 'account')
    expect(mocks.updates[0]).toMatchObject({ usageVisibility: 'friends' })
    expect(mocks.poolPeerIds).toHaveBeenCalled()
  })

  it('fills only a missing level from the stored document', () => {
    const current = { account: { usageVisibility: 'pool' as const } }
    const stripped: { theme: string; usageVisibility?: UsageVisibility } = { theme: 'dark' }
    expect(withStoredUsageVisibility(stripped, current)).toEqual({ theme: 'dark', usageVisibility: 'pool' })
    expect(withStoredUsageVisibility({ usageVisibility: 'public' as const }, current)).toEqual({ usageVisibility: 'public' })
  })

  it('rejects unknown visibility levels', async () => {
    const current = await loadManagementSettings('me')
    await expect(planManagementSettings('me', { ...current, account: { ...current.account, usageVisibility: 'everyone' } }))
      .rejects.toThrow()
    expect(mocks.updates).toHaveLength(0)
  })
})

describe('management account settings routes', () => {
  async function server() {
    const app = Fastify()
    app.addHook('preHandler', async (request: FastifyRequest) => {
      request.user = { id: 'me', role: 'user', blocked: false } as FastifyRequest['user']
      request.managementTokenId = 'token'
      request.managementScopes = ['account:read', 'account:write']
    })
    await registerManagementRoutes(app)
    return app
  }

  it('plans and applies an account document without usageVisibility as keeping the stored level', async () => {
    mocks.state.profile.usageVisibility = 'pool'
    const app = await server()
    try {
      const fetched = await app.inject('/api/management/v1/settings/account')
      expect(fetched.statusCode).toBe(200)
      const { usageVisibility: _usageVisibility, ...account } = fetched.json().account
      const document = { ...fetched.json(), account: { ...account, theme: 'dark' } }

      const plan = await app.inject({ method: 'POST', url: '/api/management/v1/settings/account/plan', payload: { document } })
      expect(plan.statusCode).toBe(200)
      expect(plan.json().changes).toEqual([{ path: 'account.theme', before: 'system', after: 'dark' }])
      expect(plan.json().document.account.usageVisibility).toBe('pool')

      const applied = await app.inject({
        method: 'POST', url: '/api/management/v1/settings/account/apply', payload: { document, revision: plan.json().revision },
      })
      expect(applied.statusCode).toBe(200)
      expect(applied.json().account).toMatchObject({ theme: 'dark', usageVisibility: 'pool' })
      expect(mocks.updates[0]).toMatchObject({ usageVisibility: 'pool' })
    } finally {
      await app.close()
    }
  })
})
