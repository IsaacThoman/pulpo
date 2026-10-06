import { EventEmitter } from 'node:events'
import type { FastifyReply } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { createRedis } from '../redis.js'
import { readResponseEvents } from '../responses/events.js'
import { executePublicGeneration, waitForTerminalResponse } from './generation.js'

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
  return { request: { requestReceivedAt: createdAt }, code: vi.fn().mockReturnThis() } as unknown as FastifyReply
}

describe('public generation execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows = []
    mocks.insertedChats = []
    mocks.createResponse.mockResolvedValue(row)
  })

  it('rejects unknown models before creating the temporary chat', async () => {
    await expect(executePublicGeneration({
      reply: reply(),
      key: { id: 'key-1', userId: 'user-1' },
      request: {
        protocol: 'anthropic_messages', model: 'missing-model', rawInput: 'hello', displayInput: 'hello', parameters: {},
        stream: false, background: false, publiclyStored: true, ignoredParameters: [], fingerprintValue: {},
      },
    })).rejects.toMatchObject({ statusCode: 400, code: 'model_not_found' })
    expect(mocks.insertedChats).toEqual([])
    expect(mocks.createResponse).not.toHaveBeenCalled()
  })

  it('submits through createResponse with API-key attribution and the existing billing path', async () => {
    // The idempotency lookup reads no `response` from this row; the model lookup finds the model.
    mocks.selectRows = [{ id: 'model-1' }]
    const response = reply()
    await executePublicGeneration({
      reply: response,
      key: { id: 'key-1', userId: 'user-1' },
      idempotencyKey: 'retry-1',
      request: {
        protocol: 'responses', model: 'model-1', rawInput: 'hello', displayInput: 'hello',
        parameters: {
          include: ['reasoning.encrypted_content'],
          prompt_cache_key: 'raw-cache-key',
          safety_identifier: 'raw-safety-id',
        },
        maxOutputTokens: 20, stream: false, background: true,
        metadata: { trace: '1' }, publiclyStored: false, ignoredParameters: [],
        fingerprintValue: { model: 'model-1', input: 'hello' },
      },
    })

    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      requestReceivedAt: createdAt,
      ownerUserId: 'user-1', apiKeyId: 'key-1', idempotencyKey: 'retry-1',
      idempotencyScope: 'api:key-1:responses', metadata: { trace: '1' }, rawInput: 'hello',
      publiclyStored: false,
      parameters: {
        include: ['reasoning.encrypted_content'],
        prompt_cache_key: expect.stringMatching(/^pulpo_pc_/),
        safety_identifier: expect.stringMatching(/^pulpo_si_/),
      },
      input: expect.objectContaining({ modelId: 'model-1', executionMode: 'background', maxOutputTokens: 20 }),
    }))
    const persistedParameters = mocks.createResponse.mock.calls[0]![0].parameters as Record<string, unknown>
    expect(persistedParameters.prompt_cache_key).not.toBe('raw-cache-key')
    expect(persistedParameters.safety_identifier).not.toBe('raw-safety-id')
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

describe('public generation streaming keep-alive', () => {
  function streamingReply() {
    const raw = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(function (this: { writableEnded: boolean }) { this.writableEnded = true }),
    })
    const reply = { request: { requestReceivedAt: createdAt }, hijack: vi.fn(), raw } as unknown as FastifyReply
    return { reply, raw }
  }

  const streamRequest = (protocol: 'responses' | 'anthropic_messages') => ({
    protocol, model: 'model-1', rawInput: 'hello', displayInput: 'hello', parameters: {},
    stream: true, background: false, publiclyStored: true, ignoredParameters: [], fingerprintValue: {},
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // The model lookup and the stream's status check both read this row; it stays in progress.
    mocks.selectRows = [{ id: 'model-1', status: 'in_progress' }]
    mocks.createResponse.mockResolvedValue(row)
    const subscriber = Object.assign(new EventEmitter(), { subscribe: vi.fn(async () => undefined), disconnect: vi.fn() })
    vi.mocked(createRedis).mockReturnValue(subscriber as never)
    vi.mocked(readResponseEvents).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes SSE comment keep-alives every 15 seconds until the client disconnects', async () => {
    const { reply, raw } = streamingReply()
    await executePublicGeneration({ reply, key: { id: 'key-1', userId: 'user-1' }, request: streamRequest('responses') })
    expect(raw.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(14_999)
    expect(raw.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(raw.write).toHaveBeenCalledWith(': keep-alive\n\n')
    vi.advanceTimersByTime(15_000)
    expect(raw.write).toHaveBeenCalledTimes(2)
    raw.emit('close')
    vi.advanceTimersByTime(60_000)
    expect(raw.write).toHaveBeenCalledTimes(2)
    expect(raw.end).toHaveBeenCalledTimes(1)
  })

  it('uses the projector keep-alive frame for Anthropic streams', async () => {
    const { reply, raw } = streamingReply()
    await executePublicGeneration({ reply, key: { id: 'key-1', userId: 'user-1' }, request: streamRequest('anthropic_messages') })
    vi.advanceTimersByTime(15_000)
    expect(raw.write).toHaveBeenCalledWith('event: ping\ndata: {"type":"ping"}\n\n')
  })
})

describe('waitForTerminalResponse', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls for up to an hour before giving up', async () => {
    vi.useFakeTimers()
    mocks.selectRows = [{ id: 'response-1', status: 'in_progress' }]
    const outcome = waitForTerminalResponse('response-1').then(() => 'resolved', (error: Error) => error.message)
    // Well past the previous six-minute limit, the request is still waiting.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    mocks.selectRows = [{ id: 'response-1', status: 'completed' }]
    await vi.advanceTimersByTimeAsync(200)
    await expect(outcome).resolves.toBe('resolved')

    mocks.selectRows = [{ id: 'response-1', status: 'in_progress' }]
    const timedOut = waitForTerminalResponse('response-1').then(() => 'resolved', (error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(18_000 * 200)
    await expect(timedOut).resolves.toBe('Response did not reach a terminal state')
  })
})
