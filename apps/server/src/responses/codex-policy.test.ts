import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'

const state = vi.hoisted(() => ({
  enabled: false,
  provider: '',
  modelId: 'codex:test',
  effectiveModelId: 'codex:test',
  status: 'queued',
  agentMode: false,
  responseError: undefined as unknown,
  writes: [] as Array<{ table: string; value: Record<string, unknown> }>,
  pricing: vi.fn(), release: vi.fn(), snapshot: vi.fn(), usage: vi.fn(), agent: vi.fn(), queue: vi.fn(),
}))
vi.mock('../database/client.js', () => {
  const model = () => ({ id: state.modelId, providerConnectionId: state.provider, enabled: true })
  const response = () => ({ id: 'response', userId: 'user', chatId: 'chat', agentMode: state.agentMode, status: state.status, error: state.responseError, updatedAt: new Date(), output: [], lastSequence: 0 })
  const db = {
    select: (projection?: Record<string, unknown>) => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table)
      const query = {
        innerJoin: () => query, where: () => query, for: () => query,
        limit: async () => name === 'application_settings' ? [{ value: { enabled: state.enabled } }]
          : name === 'models' ? [model()]
          : name === 'chats' ? [{ id: 'chat', temporary: false }]
          : name === 'user_provider_credentials' ? [{ status: 'connected' }]
          : name === 'responses' ? [projection?.response ? {
            response: response(), model: model(), log: { id: 'log', createdAt: new Date() }, chatTemporary: false,
          } : response()] : [],
      }
      return query
    } }),
    execute: vi.fn(),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => ({ where: async () => {
      const name = getTableName(table)
      state.writes.push({ table: name, value })
      if (name === 'responses') {
        if (typeof value.status === 'string') state.status = value.status
        if (value.error) state.responseError = value.error
      }
    } }) }),
  }
  return { db }
})
vi.mock('./presets.js', async (original) => ({
  ...await original<typeof import('./presets.js')>(),
  resolvePresetActions: async () => ({ effectiveModelId: state.effectiveModelId, parameters: {} }),
}))
vi.mock('../accounting/service.js', () => ({ getActivePricing: state.pricing, releaseBudget: state.release, reserveBudget: vi.fn(), settleBudget: vi.fn() }))
vi.mock('../jobs.js', () => ({ generationQueue: { add: state.queue }, maintenanceQueue: {} }))
vi.mock('../redis.js', () => ({ redis: {} }))
vi.mock('./events.js', () => ({ publishSnapshot: state.snapshot, createResponseEventPublisher: vi.fn(), isCancellationRequested: vi.fn() }))
vi.mock('../admin/usage-events.js', () => ({ publishAdminUsage: state.usage }))
vi.mock('../agent/runner.js', () => ({ processAgentGeneration: state.agent }))

import { CODEX_PROVIDER_ID } from '../codex/constants.js'
import { createResponse } from './service.js'
import { processGeneration } from './worker.js'

const create = (modelId = 'codex:test') => createResponse({
  ownerUserId: 'user', chatId: 'chat',
  input: { modelId, input: 'Hello', attachmentIds: [], presetSelections: {}, agentMode: false },
})

describe('Codex generation enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.enabled = false; state.provider = CODEX_PROVIDER_ID; state.modelId = 'codex:test'; state.effectiveModelId = 'codex:test'
    state.agentMode = false; state.status = 'queued'; state.responseError = undefined; state.writes = []
    state.pricing.mockRejectedValue(new Error('Reached ordinary pricing'))
  })

  it.each(['codex:test', 'redirect-to-codex'])('rejects disabled effective Codex models for %s before reserving or queuing', async (modelId) => {
    await expect(create(modelId)).rejects.toMatchObject({ statusCode: 403, code: 'codex_disabled' })
    expect(state.pricing).not.toHaveBeenCalled()
    expect(state.queue).not.toHaveBeenCalled()
  })

  it('permits retained connected credentials when re-enabled', async () => {
    state.enabled = true
    await expect(create()).rejects.toThrow('Reached ordinary pricing')
    expect(state.pricing).toHaveBeenCalledOnce()
  })

  it('does not block ordinary models while Codex is off', async () => {
    state.provider = 'ordinary-provider'; state.modelId = 'ordinary'; state.effectiveModelId = 'ordinary'
    await expect(create('ordinary')).rejects.toThrow('Reached ordinary pricing')
    expect(state.pricing).toHaveBeenCalledOnce()
  })

  it('lets an already-running Codex agent continue while disabled', async () => {
    state.agentMode = true; state.status = 'in_progress'
    await processGeneration('response')
    expect(state.agent).toHaveBeenCalledWith('response', true)
    expect(state.release).not.toHaveBeenCalled()
    expect(state.writes).toEqual([])
  })

  it('terminally fails queued Codex work, releases its budget, and publishes its snapshot without retries', async () => {
    await processGeneration('response')
    expect(state.status).toBe('failed')
    expect(state.responseError).toMatchObject({ code: 'codex_disabled' })
    expect(state.writes).toContainEqual(expect.objectContaining({ table: 'request_logs', value: expect.objectContaining({ status: 'failed' }) }))
    expect(state.release).toHaveBeenCalledWith('response')
    expect(state.snapshot).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: expect.objectContaining({ code: 'codex_disabled' }) }))
    expect(state.usage).toHaveBeenCalledWith('log', true)
    expect(state.queue).not.toHaveBeenCalled()
    expect(state.agent).not.toHaveBeenCalled()
    await processGeneration('response')
    expect(state.release).toHaveBeenCalledOnce()
  })
})
