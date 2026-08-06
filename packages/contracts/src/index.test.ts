import { describe, expect, it } from 'vitest'
import {
  applyResponseEventToSnapshot,
  adminUsageEventSchema,
  chatSummarySchema,
  chatPresetsSchema,
  createModelSchema,
  createChatResponseSchema,
  DEFAULT_OCR_SYSTEM_PROMPT,
  mergeResponseSnapshots,
  mobileConfigSchema,
  modelPreferencesPatchSchema,
  modelPreferencesSchema,
  nativeLoginInputSchema,
  ocrSettingsSchema,
  persistChatResponseSchema,
  responseEventSchema,
  startChatSchema,
  syncRequestSchema,
  type ResponseEvent,
  type ResponseSnapshot,
} from './index.js'

const streamingSnapshot: ResponseSnapshot = {
  responseId: '00000000-0000-4000-8000-000000000001',
  status: 'in_progress',
  sequence: 0,
  output: [],
  usage: null,
  error: null,
  updatedAt: '2026-07-31T00:00:00.000Z',
}

function delta(type: string, text: string, sequence: number): ResponseEvent {
  return {
    responseId: streamingSnapshot.responseId,
    sequence,
    type,
    payload: { delta: text },
    emittedAt: `2026-07-31T00:00:0${sequence}.000Z`,
  }
}

function targetedDelta(type: string, text: string, sequence: number, itemId: string): ResponseEvent {
  return { ...delta(type, text, sequence), payload: { delta: text, item_id: itemId } }
}

describe('shared contracts', () => {
  it('defaults missing in-flight response ids in chat summaries', () => {
    const summary = {
      id: crypto.randomUUID(),
      title: 'Active chat',
      modelId: 'model',
      pinned: false,
      folderId: null,
      temporary: false,
      updatedAt: '2026-08-05T00:00:00.000Z',
      activeResponseId: null,
    }
    expect(chatSummarySchema.parse(summary).inFlightResponseIds).toEqual([])

    const responseId = crypto.randomUUID()
    expect(chatSummarySchema.parse({ ...summary, inFlightResponseIds: [responseId] }).inFlightResponseIds)
      .toEqual([responseId])
  })

  it('requires persisted chat responses to clear temporary retention', () => {
    const summary = {
      id: crypto.randomUUID(),
      title: 'Saved chat',
      modelId: 'model',
      pinned: false,
      folderId: null,
      temporary: false,
      expiresAt: null,
      updatedAt: '2026-08-05T00:00:00.000Z',
      activeResponseId: null,
    }
    expect(persistChatResponseSchema.parse(summary)).toMatchObject({ temporary: false, expiresAt: null })
    expect(() => persistChatResponseSchema.parse({ ...summary, temporary: true })).toThrow()
  })

  it('uses the Pulpo Proxy OCR prompt by default', () => {
    expect(ocrSettingsSchema.parse({}).systemPrompt).toBe(DEFAULT_OCR_SYSTEM_PROMPT)
  })

  it('defaults and validates per-model compaction policy', () => {
    const policy = createModelSchema.pick({
      compactionEnabled: true,
      compactionThresholdTokens: true,
      agentCompactionThresholdTokens: true,
      compactionRetainedTurns: true,
    })
    expect(policy.parse({})).toEqual({
      compactionEnabled: true,
      compactionThresholdTokens: 100_000,
      agentCompactionThresholdTokens: 180_000,
      compactionRetainedTurns: 4,
    })
    expect(policy.safeParse({ compactionThresholdTokens: 1_999 }).success).toBe(false)
    expect(policy.safeParse({ agentCompactionThresholdTokens: 1_000_001 }).success).toBe(false)
    expect(policy.safeParse({ compactionRetainedTurns: 33 }).success).toBe(false)
  })

  it('rejects response events without a positive sequence', () => {
    const result = responseEventSchema.safeParse({
      responseId: crypto.randomUUID(),
      sequence: 0,
      type: 'response.created',
      payload: {},
      emittedAt: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('accepts per-response synchronization cursors', () => {
    const responseId = crypto.randomUUID()
    const result = syncRequestSchema.parse({
      tabId: 'tab-1',
      accountRevision: 3,
      responseCursors: { [responseId]: 42 },
    })
    expect(result.responseCursors[responseId]).toBe(42)
  })

  it('accepts generic composer presets', () => {
    const presets = chatPresetsSchema.parse([{
      id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'medium',
      choices: [
        { id: 'off', displayName: 'Off', action: { type: 'none' } },
        { id: 'medium', displayName: 'Medium', icon: 'sparkles', action: { type: 'params', params: { reasoning_effort: 'medium' } } },
      ],
    }])
    expect(presets[0]?.defaultChoiceId).toBe('medium')
  })

  it('normalizes ordered account model preferences', () => {
    expect(modelPreferencesSchema.parse({
      favoriteModelIds: ['model-b', 'model-a', 'model-b'],
      providerOrder: ['lab-two', 'lab-one', 'lab-two'],
    })).toEqual({
      favoriteModelIds: ['model-b', 'model-a'],
      providerOrder: ['lab-two', 'lab-one'],
    })
    expect(modelPreferencesSchema.parse({})).toEqual({ favoriteModelIds: [], providerOrder: [] })
    expect(modelPreferencesPatchSchema.safeParse({ favoriteModelIds: [42] }).success).toBe(false)
    expect(modelPreferencesPatchSchema.safeParse({ providerOrder: Array.from({ length: 501 }, (_, index) => `lab-${index}`) }).success).toBe(false)
  })

  it('validates native sessions and instance discovery', () => {
    expect(nativeLoginInputSchema.parse({
      email: 'member@example.com', password: 'password', deviceLabel: 'Isaac’s iPhone',
    }).deviceLabel).toBe('Isaac’s iPhone')
    expect(mobileConfigSchema.safeParse({
      mobileApiVersion: 1,
      instance: { name: 'Pulpo', version: '1.0.0', publicUrl: 'https://pulpo.baby' },
      setupRequired: false,
      auth: { signupEnabled: true, pendingDetails: true, adminEmail: '', pendingMessage: 'Pending' },
      capabilities: {
        bearerSessions: true, realtime: true, chatDuplication: true,
        publicSharing: true, attachments: true, folders: true,
      },
    }).success).toBe(true)
  })

  it('tracks agent turns separately from retry attempts', () => {
    const event = adminUsageEventSchema.parse({
      requestId: crypto.randomUUID(),
      responseId: crypto.randomUUID(),
      status: 'in_progress',
      elapsedMs: 1_000,
      currentModelId: 'kimi-k3',
      retryAttempt: 1,
      turnNumber: 5,
      retryCount: 0,
      fallbackUsed: false,
      ocrStatus: 'not_requested',
      eventCount: 5,
      inputTokens: 100,
      outputTokens: 50,
      updatedAt: new Date().toISOString(),
    })

    expect(event).toMatchObject({ retryAttempt: 1, turnNumber: 5, retryCount: 0 })
  })

  it.each([
    { name: 'malformed IDs', value: [{ id: 'Not Valid', name: 'Reasoning', icon: 'brain', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }] }] },
    { name: 'empty choices', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', choices: [] }] },
    { name: 'invalid defaults', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'missing', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }] }] },
    { name: 'unsupported actions', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', choices: [{ id: 'on', displayName: 'On', action: { type: 'script' } }] }] },
    { name: 'duplicate preset IDs', value: [
      { id: 'style', name: 'Style', icon: 'sparkles', choices: [{ id: 'a', displayName: 'A', action: { type: 'none' } }] },
      { id: 'style', name: 'Style again', icon: 'sparkles', choices: [{ id: 'b', displayName: 'B', action: { type: 'none' } }] },
    ] },
    { name: 'too many choices', value: [{ id: 'style', name: 'Style', icon: 'sparkles', choices: Array.from({ length: 21 }, (_, index) => ({ id: `choice-${index}`, displayName: `Choice ${index}`, action: { type: 'none' } })) }] },
  ])('rejects $name', ({ value }) => {
    expect(chatPresetsSchema.safeParse(value).success).toBe(false)
  })
})

describe('response snapshot accumulation', () => {
  it('does not lose text across active snapshots without output', () => {
    const first = applyResponseEventToSnapshot(streamingSnapshot, delta('response.output_text.delta', 'chunk A', 1))
    const checkpoint = mergeResponseSnapshots(first, { ...streamingSnapshot, sequence: 2 })
    const second = applyResponseEventToSnapshot(checkpoint, delta('response.output_text.delta', ' chunk B', 3))
    const nextCheckpoint = mergeResponseSnapshots(second, { ...streamingSnapshot, sequence: 4 })
    const third = applyResponseEventToSnapshot(nextCheckpoint, delta('response.output_text.delta', ' chunk C', 5))

    expect(third.output).toMatchObject([{ content: [{ text: 'chunk A chunk B chunk C' }] }])
  })

  it('keeps snapshots and events monotonic by sequence', () => {
    const current = applyResponseEventToSnapshot(streamingSnapshot, delta('response.output_text.delta', 'current', 3))
    const duplicate = applyResponseEventToSnapshot(current, delta('response.output_text.delta', ' duplicate', 3))
    const older = mergeResponseSnapshots(current, { ...streamingSnapshot, sequence: 2 })

    expect(duplicate).toBe(current)
    expect(older).toBe(current)
  })

  it('uses snapshot time and terminal status to order equal event sequences', () => {
    const current = { ...streamingSnapshot, sequence: 3, updatedAt: '2026-07-31T00:00:03.000Z' }
    const stale = { ...current, updatedAt: '2026-07-31T00:00:02.000Z', output: [{ stale: true }] }
    const terminal = { ...stale, status: 'completed' as const }

    expect(mergeResponseSnapshots(current, stale)).toBe(current)
    expect(mergeResponseSnapshots(current, terminal)).toBe(terminal)
    expect(mergeResponseSnapshots(terminal, current)).toBe(terminal)
  })

  it('keeps reasoning separate from assistant output', () => {
    const reasoned = applyResponseEventToSnapshot(streamingSnapshot, delta('response.reasoning_summary_text.delta', 'Think', 1))
    const answered = applyResponseEventToSnapshot(reasoned, delta('response.output_text.delta', 'Answer', 2))

    expect(answered.output).toMatchObject([
      { type: 'reasoning', summary: [{ text: 'Think' }] },
      { type: 'message', content: [{ text: 'Answer' }] },
    ])
  })

  it('accepts terminal output as authoritative', () => {
    const provisional = applyResponseEventToSnapshot(streamingSnapshot, delta('response.output_text.delta', 'partial', 1))
    const terminal = mergeResponseSnapshots(provisional, {
      ...streamingSnapshot,
      status: 'completed',
      sequence: 2,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'final answer' }] }],
    })

    expect(terminal.status).toBe('completed')
    expect(terminal.output).toMatchObject([{ content: [{ text: 'final answer' }] }])
  })

  it('applies agent deltas to the targeted turn instead of the first output item', () => {
    const snapshot = {
      ...streamingSnapshot,
      sequence: 4,
      output: [
        { id: 'agent:1:0:message', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'First turn' }] },
        { id: 'tool-1', type: 'pulpo_tool', status: 'completed' },
        { id: 'agent:2:0:message', type: 'message', status: 'in_progress', content: [{ type: 'output_text', text: 'Second' }] },
      ],
    }
    const result = applyResponseEventToSnapshot(
      snapshot,
      targetedDelta('response.output_text.delta', ' turn', 5, 'agent:2:0:message'),
    )

    expect(result.output).toMatchObject([
      { id: 'agent:1:0:message', content: [{ text: 'First turn' }] },
      { id: 'tool-1' },
      { id: 'agent:2:0:message', content: [{ text: 'Second turn' }] },
    ])
  })

  it('starts a distinct message when the first delta for a new agent turn precedes its snapshot', () => {
    const snapshot = {
      ...streamingSnapshot,
      sequence: 4,
      output: [
        {
          id: 'agent:1:0:message',
          type: 'message',
          status: 'in_progress',
          content: [{ type: 'output_text', text: 'First turn' }],
        },
        { id: 'tool-1', type: 'pulpo_tool', status: 'completed' },
      ],
    }

    const started = applyResponseEventToSnapshot(
      snapshot,
      targetedDelta('response.output_text.delta', 'Second', 5, 'agent:2:0:message'),
    )
    const continued = applyResponseEventToSnapshot(
      started,
      targetedDelta('response.output_text.delta', ' turn', 6, 'agent:2:0:message'),
    )

    expect(continued.output).toMatchObject([
      { id: 'agent:1:0:message', content: [{ text: 'First turn' }] },
      { id: 'tool-1' },
      { id: 'agent:2:0:message', content: [{ text: 'Second turn' }] },
    ])
  })

  it('starts distinct reasoning when a targeted reasoning item has not been checkpointed yet', () => {
    const snapshot = {
      ...streamingSnapshot,
      sequence: 7,
      output: [{
        id: 'agent:1:0:reasoning',
        type: 'reasoning',
        status: 'in_progress',
        summary: [{ type: 'summary_text', text: 'First thought' }],
      }],
    }
    const result = applyResponseEventToSnapshot(
      snapshot,
      targetedDelta('response.reasoning_summary_text.delta', 'Next thought', 8, 'agent:2:0:reasoning'),
    )

    expect(result.output).toMatchObject([
      { id: 'agent:1:0:reasoning', summary: [{ text: 'First thought' }] },
      { id: 'agent:2:0:reasoning', summary: [{ text: 'Next thought' }] },
    ])
  })

  it('accepts an explicit branch parent for follow-up generation', () => {
    const parentResponseId = '00000000-0000-4000-8000-000000000002'
    const parsed = createChatResponseSchema.parse({
      parentResponseId,
      input: 'Follow this branch',
      modelId: 'model',
    })

    expect(parsed.parentResponseId).toBe(parentResponseId)
  })

  it('requires stable chat and response IDs for atomic chat startup', () => {
    const chatId = '00000000-0000-4000-8000-000000000002'
    const responseId = '00000000-0000-4000-8000-000000000003'
    expect(startChatSchema.parse({
      chat: { clientId: chatId, modelId: 'model-1', title: 'Hello' },
      response: { clientId: responseId, input: 'Hello', modelId: 'model-1' },
    })).toMatchObject({ chat: { clientId: chatId }, response: { clientId: responseId } })
    expect(() => startChatSchema.parse({
      chat: { modelId: 'model-1' },
      response: { clientId: responseId, input: 'Hello', modelId: 'model-1' },
    })).toThrow()
  })

})
