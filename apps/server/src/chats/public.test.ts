import { describe, expect, it } from 'vitest'
import { toPublicChat, toPublicChatResponse } from './public.js'

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
})
