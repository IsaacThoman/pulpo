import { describe, expect, it } from 'vitest'
import { toPublicChat, toPublicChatResponse, toPublicChatResponseStub } from './public.js'

const date = new Date('2026-08-07T12:00:00.000Z')

describe('public chat DTOs', () => {
  it('only exposes client-supported chat fields', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000001', userId: 'private-user', folderId: null,
      title: 'Chat', modelId: 'model-1', pinned: false, sortOrder: 0, temporary: false,
      activeBranchLeafId: null, activeResponseId: null, expiresAt: null, deletedAt: null,
      purgeStartedAt: null, createdAt: date, updatedAt: date,
    }
    const result = toPublicChat(row)
    expect(result).toMatchObject({ id: row.id, title: 'Chat', createdAt: date.toISOString() })
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('deletedAt')
    expect(result).not.toHaveProperty('purgeStartedAt')
  })

  it('does not expose internal response persistence fields', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000002',
      chatId: '00000000-0000-4000-8000-000000000001', userId: 'private-user',
      modelId: 'model-1', actualModelId: 'model-actual', origin: 'web', pricingVersionId: 'private-pricing',
      openaiResponseId: 'private-provider-id', previousResponseId: null, parentResponseId: null,
      userMessageId: '00000000-0000-4000-8000-000000000003', branchReason: 'message', status: 'completed' as const,
      executionMode: 'stream' as const, agentMode: true, agentCapacityAction: null,
      input: [{ role: 'user', content: 'hello' }], instructions: 'private instructions',
      presetSelections: {}, parameters: { private: true },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'answer' }] }],
      usage: null, error: null, lastSequence: 2, upstreamSequence: 3,
      idempotencyKey: 'private-key', startedAt: date, completedAt: date, deletedAt: null,
      createdAt: date, updatedAt: date,
    }
    const result = toPublicChatResponse(row, [row])

    expect(result).toMatchObject({ id: row.id, displayModelId: 'model-actual', agentMode: true })
    for (const field of [
      'chatId', 'userId', 'origin', 'pricingVersionId', 'openaiResponseId', 'branchReason',
      'executionMode', 'agentCapacityAction', 'instructions', 'parameters', 'lastSequence',
      'upstreamSequence', 'idempotencyKey', 'startedAt', 'deletedAt', 'updatedAt',
    ]) expect(result).not.toHaveProperty(field)
  })

  it('sends output once in compact history while retaining the legacy shape', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000002',
      chatId: '00000000-0000-4000-8000-000000000001', userId: 'private-user',
      modelId: 'model-1', actualModelId: null, origin: 'web', pricingVersionId: null,
      openaiResponseId: null, previousResponseId: null, parentResponseId: null,
      userMessageId: null, branchReason: 'message', status: 'completed' as const,
      executionMode: 'stream' as const, agentMode: false, agentCapacityAction: null,
      input: [], instructions: null, presetSelections: {}, parameters: {},
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'unique-output-sentinel' }] }],
      usage: null, error: null, lastSequence: 1, upstreamSequence: 1, idempotencyKey: null,
      startedAt: date, completedAt: date, deletedAt: null, createdAt: date, updatedAt: date,
    }
    const legacy = toPublicChatResponse(row, [row])
    const compact = toPublicChatResponse(row, [row], { compact: true })

    expect('output' in legacy.snapshot).toBe(true)
    expect('output' in compact.snapshot).toBe(false)
    expect(JSON.stringify(legacy).split('unique-output-sentinel')).toHaveLength(3)
    expect(JSON.stringify(compact).split('unique-output-sentinel')).toHaveLength(2)
  })

  it('keeps inactive branch topology without transferring its body', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000002',
      chatId: '00000000-0000-4000-8000-000000000001', userId: 'private-user',
      modelId: 'model-1', actualModelId: null, origin: 'web', pricingVersionId: null,
      openaiResponseId: null, previousResponseId: null, parentResponseId: null,
      userMessageId: '00000000-0000-4000-8000-000000000003', branchReason: 'message', status: 'completed' as const,
      executionMode: 'stream' as const, agentMode: false, agentCapacityAction: null,
      input: [{ role: 'user', content: 'large inactive prompt' }], instructions: null,
      presetSelections: { style: 'long' }, parameters: {},
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'large inactive answer' }] }],
      usage: { inputTokens: 1, outputTokens: 1 }, error: { message: 'hidden with body' },
      lastSequence: 1, upstreamSequence: 1, idempotencyKey: null,
      startedAt: date, completedAt: date, deletedAt: null, createdAt: date, updatedAt: date,
    }
    const stub = toPublicChatResponseStub(row, [row])

    expect(stub).toMatchObject({ id: row.id, parentResponseId: null, detailAvailable: false })
    expect(stub.input).toEqual([])
    expect(stub.output).toEqual([])
    expect(JSON.stringify(stub)).not.toContain('large inactive')
  })
})
