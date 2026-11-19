import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import type { ComputerSelection } from '@pulpo/contracts'

const state = vi.hoisted(() => ({
  agent: { enabled: true, computerAccess: true } as Record<string, unknown>,
  inserted: null as Record<string, unknown> | null,
}))
vi.mock('../database/client.js', () => {
  const chat = { id: 'chat', userId: 'user', temporary: false, activeResponseId: null, activeBranchLeafId: null, workspaceScopeId: 'scope', fileScopeIds: [], expiresAt: null }
  const rows = (name: string) => name === 'application_settings' ? [{ key: 'agent', value: state.agent }]
    : name === 'models' ? [{ id: 'model', providerConnectionId: 'provider', enabled: true, agentEnabled: true, executionMode: 'stream', maxOutputTokens: 1000, allowedParameters: [] }]
    : name === 'chats' ? [chat] : []
  const db = {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table)
      const query = {
        innerJoin: () => query, where: () => query, for: () => query, orderBy: () => query,
        limit: async () => rows(name),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows(name)).then(resolve),
      }
      return query
    } }),
    insert: () => ({ values: (value: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => {
      state.inserted = value
      // Stop here: the test only cares what admission would store.
      throw new Error('inserted')
    } }) }) }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  }
  return { db }
})
vi.mock('./presets.js', async (original) => ({
  ...await original<typeof import('./presets.js')>(),
  resolvePresetActions: async () => ({ effectiveModelId: 'model', parameters: {}, selections: {} }),
}))
vi.mock('../accounting/service.js', () => ({ getActivePricing: vi.fn(async () => null), releaseBudget: vi.fn(), reserveBudget: vi.fn() }))
vi.mock('../jobs.js', () => ({ generationQueue: { add: vi.fn() }, maintenanceQueue: {} }))
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('../catalog/model-access.js', () => ({ assertModelsAccessibleToUser: vi.fn(async () => undefined) }))
vi.mock('../catalog/model-platforms.js', () => ({ assertModelsAvailableOnPlatform: vi.fn(async () => undefined) }))

import { createResponse } from './service.js'

const computer: ComputerSelection = { sessionId: '6f0c2a7e-1d6b-4c43-9a51-0d3c5b7f2a10', access: 'full', folder: null }
const desktop = { platform: 'desktop' as const, version: '1.0.0', features: ['computer' as const] }
const create = (overrides: { agentMode?: boolean; client?: typeof desktop | null; apiKeyId?: string; actorUserId?: string } = {}) => createResponse({
  ownerUserId: 'user', chatId: 'chat', parentResponseId: null,
  client: overrides.client === undefined ? desktop : overrides.client, apiKeyId: overrides.apiKeyId, actorUserId: overrides.actorUserId,
  input: { modelId: 'model', input: 'Hello', attachmentIds: [], presetSelections: {}, agentMode: overrides.agentMode ?? true, computer },
})

describe('createResponse with a computer', () => {
  beforeEach(() => {
    state.agent = { enabled: true, computerAccess: true }
    state.inserted = null
  })

  it('stores the computer on an agent reply from the desktop app', async () => {
    await expect(create()).rejects.toThrow('inserted')
    expect(state.inserted).toMatchObject({ agentMode: true, origin: 'web', computer })
  })

  it('drops it from a reply that does not run in Agent mode', async () => {
    await expect(create({ agentMode: false, client: null })).rejects.toThrow('inserted')
    expect(state.inserted).toMatchObject({ agentMode: false, computer: null })
  })

  it('refuses it when the setting is off, the app lacks the bridge, or an admin is acting', async () => {
    state.agent = { enabled: true, computerAccess: false }
    await expect(create()).rejects.toMatchObject({ statusCode: 400, code: 'computer_unavailable' })
    state.agent = { enabled: true, computerAccess: true }
    await expect(create({ client: { ...desktop, features: [] as never[] } })).rejects.toMatchObject({ code: 'computer_unavailable' })
    await expect(create({ actorUserId: 'admin' })).rejects.toMatchObject({ code: 'computer_unavailable' })
    expect(state.inserted).toBeNull()
  })
})
