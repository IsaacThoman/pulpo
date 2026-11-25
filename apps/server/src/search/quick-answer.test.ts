import { createHash } from 'node:crypto'
import Fastify, { type FastifyReply } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelQuickAnswer, quickAnswerCapability, quickAnswerText, startQuickAnswer, streamQuickAnswer } from './quick-answer.js'
import { searchQuickAnswerScope } from './quick-answer-policy.js'

const mocks = vi.hoisted(() => ({
  workspace: true,
  settings: [] as Array<{ key: string; value: unknown }>,
  preferences: {} as Record<string, unknown>,
  models: [] as Array<{ id: string; name: string; agentEnabled: boolean }>,
  response: vi.fn(),
  where: vi.fn(),
  insertChat: vi.fn(),
  deleteChat: vi.fn(),
  createResponse: vi.fn(),
  resolveGeneration: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../config.js', () => ({ getConfig: () => ({
  WORKSPACE_CONTROLLER_URL: mocks.workspace ? 'http://workspace.example.org' : undefined,
  WORKSPACE_CONTROLLER_TOKEN: mocks.workspace ? 'synthetic-workspace-token' : undefined,
}) }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: {} }))
vi.mock('../responses/events.js', () => ({ requestCancellation: mocks.cancel }))
vi.mock('../responses/service.js', () => ({ createResponse: mocks.createResponse, resolveResponseGeneration: mocks.resolveGeneration }))
vi.mock('../catalog/user-models.js', () => ({ userModelEligibility: () => ({ condition: undefined }) }))
vi.mock('../database/client.js', async () => {
  const { getTableName } = await import('drizzle-orm')
  const { PgDialect } = await import('drizzle-orm/pg-core')
  const dialect = new PgDialect()
  return { db: {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table)
      const query = {
        leftJoin: () => query,
        innerJoin: () => query,
        orderBy: () => query,
        where: (filter?: Parameters<typeof dialect.sqlToQuery>[0]) => {
          const sql = filter ? dialect.sqlToQuery(filter) : { sql: '', params: [] }
          mocks.where(name, sql)
          if (name === 'application_settings') return Promise.resolve(mocks.settings)
          const filtered = {
            orderBy: () => filtered,
            limit: async () => {
              if (name === 'responses') return mocks.response()
              if (name === 'user_preferences') return [{ values: mocks.preferences }]
              const selectedId = sql.params.find(value => typeof value === 'string')
              return mocks.models.filter(row => !selectedId || row.id === selectedId).slice(0, 1)
            },
          }
          return filtered
        },
        limit: async () => mocks.models.slice(0, 1),
      }
      return query
    } }),
    insert: () => ({ values: mocks.insertChat }),
    delete: () => ({ where: mocks.deleteChat }),
  } }
})

const userId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const responseId = '00000000-0000-4000-8000-000000000003'
const chatId = '00000000-0000-4000-8000-000000000004'
const input = { query: 'What lives in tide pools?', requestId }
const assistant = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspace = true
  mocks.preferences = {}
  mocks.settings = [{ key: 'agent', value: { enabled: true } }, { key: 'auth', value: { newAccountModelDefaults: { defaultModelId: 'inherited' } } }]
  mocks.models = [{ id: 'first', name: 'First model', agentEnabled: true }, { id: 'inherited', name: 'Inherited model', agentEnabled: true }]
  mocks.response.mockReset().mockResolvedValue([])
  mocks.cancel.mockReset().mockResolvedValue(undefined)
  mocks.createResponse.mockReset().mockImplementation(async ({ chatId }) => ({ id: responseId, chatId }))
  mocks.resolveGeneration.mockReset().mockImplementation(async id => ({ effectiveModelId: id }))
})

describe('Pulpo Agent Quick Answer', () => {
  it('resolves inherited defaults and admits an isolated, metered, idempotent agent response', async () => {
    expect(await quickAnswerCapability(userId)).toEqual({ modelName: 'Inherited model' })
    const [first, repeated] = await Promise.all([startQuickAnswer(userId, input), startQuickAnswer(userId, input)])
    expect(first).toEqual({ responseId, chatId: mocks.insertChat.mock.calls[0]?.[0].id, modelName: 'Inherited model' })
    expect(repeated).toEqual(first)
    expect(mocks.insertChat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId, modelId: 'inherited', temporary: true, expiresAt: expect.any(Date), fileScopeIds: [], fileScopeAccess: {}, filesBrowseAllowed: false,
    }))
    expect(mocks.createResponse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ownerUserId: userId, parentResponseId: null, publiclyStored: false,
      idempotencyScope: searchQuickAnswerScope, idempotencyKey: requestId,
      idempotencyFingerprint: createHash('sha256').update(input.query).digest('hex'),
      client: { platform: 'web', version: null, features: [] },
      input: { input: input.query, modelId: 'inherited', presetSelections: {}, attachmentIds: [], agentMode: true, executionMode: 'stream', maxOutputTokens: 1200 },
    }))
  })

  it('rejects explicit unavailable and non-agent defaults without switching models or creating a chat', async () => {
    mocks.preferences = { defaultModelId: 'missing' }
    await expect(startQuickAnswer(userId, input)).rejects.toMatchObject({ code: 'quick_answer_default_model_unavailable' })
    mocks.preferences = { defaultModelId: 'inherited' }
    mocks.models[1]!.agentEnabled = false
    expect(await quickAnswerCapability(userId)).toBeUndefined()
    await expect(startQuickAnswer(userId, input)).rejects.toMatchObject({ code: 'quick_answer_model_not_agent_capable' })
    expect(mocks.insertChat).not.toHaveBeenCalled()
    expect(mocks.createResponse).not.toHaveBeenCalled()
  })

  it('recovers an existing matching request and rejects reuse with a different query', async () => {
    mocks.response.mockResolvedValue([{ id: responseId, chatId, modelName: 'Previous model', fingerprint: createHash('sha256').update(input.query).digest('hex') }])
    await expect(startQuickAnswer(userId, input)).resolves.toEqual({ responseId, chatId, modelName: 'Previous model' })
    await expect(startQuickAnswer(userId, { ...input, query: 'Different question' })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(mocks.createResponse).not.toHaveBeenCalled()
  })

  it('signals cancellation only for active owned Search agent responses in accessible chats', async () => {
    await expect(cancelQuickAnswer(userId, responseId)).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.cancel).not.toHaveBeenCalled()
    mocks.response.mockResolvedValueOnce([{ id: responseId, status: 'completed' }]).mockResolvedValueOnce([{ id: responseId, status: 'queued' }])
    await cancelQuickAnswer(userId, responseId)
    await cancelQuickAnswer(userId, responseId)
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(responseId)
    const query = mocks.where.mock.lastCall?.[1]
    expect(query?.sql).toContain('"chats"."user_id"')
    expect(query?.sql).toContain('"chats"."expires_at"')
    expect(query?.sql).toContain('"responses"."agent_mode"')
    expect(query?.params).toEqual(expect.arrayContaining([responseId, userId, searchQuickAnswerScope]))
    mocks.response.mockResolvedValueOnce([{ id: responseId, status: 'in_progress' }])
    mocks.cancel.mockRejectedValueOnce(new Error('private Redis detail'))
    await expect(cancelQuickAnswer(userId, responseId)).rejects.toMatchObject({ statusCode: 503, code: 'quick_answer_cancel_unavailable' })
  })

  it('streams assistant-only deltas and recovers the terminal suffix without forwarding worker internals', async () => {
    const app = Fastify()
    const otherOutput = [
      { type: 'reasoning', summary: [{ text: 'private reasoning' }] },
      { type: 'pulpo_tool', arguments: { query: 'private input' }, output: 'private tool result' },
      { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'private input' }] },
    ]
    mocks.response.mockResolvedValueOnce([{ id: responseId, status: 'in_progress', output: [...otherOutput, assistant('Tide pools')] }])
      .mockResolvedValueOnce([{ id: responseId, status: 'completed', output: [...otherOutput, assistant('Tide pools shelter crabs.')] }])
    app.get('/events', (_, reply) => streamQuickAnswer(reply, userId, responseId))
    try {
      const result = await app.inject('/events')
      expect(result.headers['content-type']).toContain('text/event-stream')
      expect(result.body).toBe(': connected\n\ndata: {"type":"text","text":"Tide pools"}\n\ndata: {"type":"text","text":" shelter crabs."}\n\ndata: {"type":"done"}\n\n')
    } finally { await app.close() }
  })

  it('keeps output bounded and denies missing or unrelated response streams', async () => {
    expect(quickAnswerText([assistant('A'.repeat(24_500))])).toBe('A'.repeat(24_000))
    await expect(streamQuickAnswer({} as FastifyReply, userId, responseId)).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([
    ['insufficient_balance', 'Add Pulpo credits to use Quick Answer.', true],
    ['daily_spend_limit_reached', 'You reached your Pulpo daily spending limit.', true],
    ['upstream_error', 'Pulpo couldn’t complete this Quick Answer.', undefined],
  ])('maps the terminal %s error without exposing worker messages', async (code, message, billing) => {
    mocks.response.mockResolvedValueOnce([{ id: responseId, status: 'failed', error: { code, message: 'Private worker details' } }])
    const app = Fastify()
    app.get('/events', (_, reply) => streamQuickAnswer(reply, userId, responseId))
    try {
      const result = await app.inject('/events')
      expect(result.body).toBe(`: connected\n\ndata: ${JSON.stringify({ type: 'error', message, billing, code: billing ? code : undefined })}\n\n`)
    } finally { await app.close() }
  })
})
