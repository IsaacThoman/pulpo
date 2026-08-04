import { describe, expect, it, vi } from 'vitest'
import type { CompactionItem } from '@pulpo/contracts'
import { compactConversation, effectiveHistoryChunks } from './compaction.js'

function turn(id: string, text = id, status = 'completed') {
  return {
    id,
    status,
    input: [{ role: 'user', content: `user ${text}` }],
    output: [{ type: 'message', role: 'assistant', content: `assistant ${text}` }],
  }
}

describe('conversation compaction', () => {
  it('keeps the configured number of complete exchanges and excludes the current user input from the summary', async () => {
    const invoke = vi.fn(async (_older: unknown[]) => 'summary')
    const updates: CompactionItem[] = []
    const currentInput = [{ role: 'user', content: 'current question' }]
    const result = await compactConversation({
      responseId: '00000000-0000-4000-8000-000000000001',
      modelId: 'resolved-hidden-model',
      enabled: true,
      thresholdTokens: 1,
      retainedTurns: 2,
      fixedContext: [{ role: 'developer', content: 'system' }],
      currentInput,
      history: [turn('00000000-0000-4000-8000-000000000011'), turn('00000000-0000-4000-8000-000000000012'), turn('00000000-0000-4000-8000-000000000013')],
      invoke,
      onUpdate: async (item) => { updates.push(item) },
    })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(invoke.mock.calls[0]?.[0])).toContain('user 00000000-0000-4000-8000-000000000011')
    expect(JSON.stringify(invoke.mock.calls[0]?.[0])).not.toContain('current question')
    expect(result.item).toMatchObject({ model_id: 'resolved-hidden-model', status: 'completed' })
    expect(result.item?.retained_context_turns).toHaveLength(2)
    expect(result.conversation).toEqual([
      { role: 'developer', content: 'Summary of earlier conversation:\nsummary' },
      ...turn('ignored', '00000000-0000-4000-8000-000000000012').input,
      ...turn('ignored', '00000000-0000-4000-8000-000000000012').output,
      ...turn('ignored', '00000000-0000-4000-8000-000000000013').input,
      ...turn('ignored', '00000000-0000-4000-8000-000000000013').output,
    ])
    expect(updates.map((item) => item.status)).toEqual(['in_progress', 'completed'])
  })

  it('reuses only completed checkpoints from successful ancestor responses', () => {
    const checkpoint: CompactionItem = {
      id: 'checkpoint', type: 'pulpo_compaction', phase: 'pre_response', status: 'completed', model_id: 'model',
      estimated_tokens: 100, threshold_tokens: 50, retained_turns: [],
      retained_context: [{ role: 'user', content: 'kept' }],
      retained_context_turns: [[{ role: 'user', content: 'kept' }]],
      summary: 'old summary', started_at: new Date(0).toISOString(),
    }
    const history = [
      turn('00000000-0000-4000-8000-000000000021'),
      { ...turn('00000000-0000-4000-8000-000000000022'), output: [checkpoint, ...turn('x').output] },
      turn('00000000-0000-4000-8000-000000000023'),
    ]
    const chunks = effectiveHistoryChunks(history)
    expect(JSON.stringify(chunks)).not.toContain('00000000-0000-4000-8000-000000000021')
    expect(JSON.stringify(chunks)).toContain('old summary')
    expect(JSON.stringify(chunks)).toContain('kept')
    expect(JSON.stringify(chunks)).toContain('00000000-0000-4000-8000-000000000022')
    expect(JSON.stringify(chunks)).toContain('00000000-0000-4000-8000-000000000023')

    const failedHistory = history.map((response, index) => index === 1 ? { ...response, status: 'failed' } : response)
    expect(JSON.stringify(effectiveHistoryChunks(failedHistory))).toContain('00000000-0000-4000-8000-000000000021')
  })

  it('does nothing when disabled even above the threshold', async () => {
    const invoke = vi.fn(async (_older: unknown[]) => 'unused')
    const history = [turn('00000000-0000-4000-8000-000000000031'), turn('00000000-0000-4000-8000-000000000032')]
    const result = await compactConversation({
      responseId: '00000000-0000-4000-8000-000000000003', modelId: 'model', enabled: false,
      thresholdTokens: 1, retainedTurns: 1, fixedContext: [], currentInput: [], history, invoke,
      onUpdate: async () => undefined,
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(result.item).toBeUndefined()
    expect(result.conversation).toHaveLength(4)
  })
})
