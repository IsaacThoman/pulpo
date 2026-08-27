import type { FastifyReply } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectRows: [] as Array<Record<string, unknown>>,
  insertedChats: [] as Array<Record<string, unknown>>,
  createResponse: vi.fn(),
}))

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.selectRows) })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async (value: Record<string, unknown>) => { mocks.insertedChats.push(value) }) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  },
}))
vi.mock('../responses/service.js', () => ({ createResponse: mocks.createResponse }))
vi.mock('../redis.js', () => ({ createRedis: vi.fn() }))
vi.mock('../responses/events.js', () => ({ readResponseEvents: vi.fn() }))
vi.mock('../chats/temporary.js', () => ({
  accessibleChatCondition: vi.fn(() => ({})),
  temporaryChatExpiresAt: vi.fn(() => new Date('2026-08-28T12:00:00.000Z')),
}))

import { executePublicGeneration } from './generation.js'

const createdAt = new Date('2026-08-27T12:00:00.000Z')
const row = {
  id: 'response-1', chatId: 'chat-1', userId: 'user-1', modelId: 'model-1', actualModelId: null,
  origin: 'api', pricingVersionId: null, openaiResponseId: null, previousResponseId: null,
  parentResponseId: null, userMessageId: null, branchReason: 'message', status: 'queued',
  executionMode: 'background', agentMode: false, agentCapacityAction: null, input: [], instructions: null,
  presetSelections: {}, parameters: {}, metadata: { trace: '1' }, publiclyStored: true, output: [], usage: null, error: null,
  incompleteDetails: null, lastSequence: 0, upstreamSequence: 0, idempotencyKey: null,
  idempotencyScope: 'api:key-1:responses', idempotencyFingerprint: null,
  startedAt: null, completedAt: null, deletedAt: null, createdAt, updatedAt: createdAt,
}

function reply(): FastifyReply {
  return { code: vi.fn().mockReturnThis() } as unknown as FastifyReply
}

describe('public generation execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows = []
    mocks.insertedChats = []
    mocks.createResponse.mockResolvedValue(row)
  })

  it('submits through createResponse with API-key attribution and the existing billing path', async () => {
    const response = reply()
    await executePublicGeneration({
      reply: response,
      key: { id: 'key-1', userId: 'user-1' },
      idempotencyKey: 'retry-1',
      request: {
        protocol: 'responses', model: 'model-1', rawInput: 'hello', displayInput: 'hello',
        parameters: {}, maxOutputTokens: 20, stream: false, background: true,
        metadata: { trace: '1' }, publiclyStored: false, ignoredParameters: [],
        fingerprintValue: { model: 'model-1', input: 'hello' },
      },
    })

    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user-1', apiKeyId: 'key-1', idempotencyKey: 'retry-1',
      idempotencyScope: 'api:key-1:responses', metadata: { trace: '1' }, rawInput: 'hello',
      publiclyStored: false,
      input: expect.objectContaining({ modelId: 'model-1', executionMode: 'background', maxOutputTokens: 20 }),
    }))
    expect(response.code).toHaveBeenCalledWith(202)
    expect(mocks.insertedChats).toHaveLength(1)
  })

  it('returns an idempotency conflict without creating or reserving another generation', async () => {
    mocks.selectRows = [{ response: { ...row, idempotencyFingerprint: 'different' } }]
    await expect(executePublicGeneration({
      reply: reply(),
      key: { id: 'key-1', userId: 'user-1' },
      idempotencyKey: 'retry-1',
      request: {
        protocol: 'responses', model: 'model-1', rawInput: 'hello', displayInput: 'hello',
        parameters: {}, stream: false, background: true, publiclyStored: true, ignoredParameters: [],
        fingerprintValue: { model: 'model-1', input: 'hello' },
      },
    })).rejects.toMatchObject({ statusCode: 409, code: 'idempotency_conflict' })
    expect(mocks.createResponse).not.toHaveBeenCalled()
    expect(mocks.insertedChats).toHaveLength(0)
  })
})
