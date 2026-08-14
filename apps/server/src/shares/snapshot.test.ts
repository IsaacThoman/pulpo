import { describe, expect, it } from 'vitest'
import { AppError } from '../lib/errors.js'
import { outputAttachmentIds, shareLineage, snapshotResponses } from './snapshot.js'

type ResponseRow = Parameters<typeof shareLineage>[0][number]

const date = new Date('2026-08-14T12:00:00.000Z')

function response(id: string, overrides: Partial<ResponseRow> = {}): ResponseRow {
  return {
    id,
    chatId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    modelId: 'model-1',
    actualModelId: null,
    origin: 'web',
    pricingVersionId: null,
    openaiResponseId: null,
    previousResponseId: null,
    parentResponseId: null,
    userMessageId: '00000000-0000-4000-8000-000000000003',
    branchReason: 'message',
    status: 'completed',
    executionMode: 'stream',
    agentMode: true,
    agentCapacityAction: null,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Question' }] }],
    instructions: 'private instructions',
    presetSelections: {},
    parameters: {},
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }],
    usage: { inputTokens: 10, outputTokens: 20 },
    error: null,
    lastSequence: 4,
    upstreamSequence: 4,
    idempotencyKey: null,
    startedAt: date,
    completedAt: date,
    deletedAt: null,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  }
}

describe('share snapshot projection', () => {
  it('captures only the selected active lineage', () => {
    const root = response('00000000-0000-4000-8000-000000000010')
    const selected = response('00000000-0000-4000-8000-000000000011', { parentResponseId: root.id })
    const sibling = response('00000000-0000-4000-8000-000000000012', { parentResponseId: root.id })

    expect(shareLineage([root, sibling, selected], selected.id).map((turn) => turn.id)).toEqual([root.id, selected.id])
  })

  it('rejects a snapshot while the selected lineage is active', () => {
    const active = response('00000000-0000-4000-8000-000000000010', { status: 'in_progress', completedAt: null })
    expect(() => shareLineage([active], active.id)).toThrowError(AppError)
    try {
      shareLineage([active], active.id)
    } catch (cause) {
      expect(cause).toMatchObject({ statusCode: 409, code: 'share_generation_in_progress' })
    }
  })

  it('preserves full reasoning, tool, workspace, and compaction output', () => {
    const output = [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Thought summary' }] },
      { type: 'pulpo_workspace', state: 'ready', durationMs: 100 },
      { type: 'pulpo_tool', tool: 'bash', arguments: { command: 'pwd' }, output: '/workspace', status: 'completed' },
      { type: 'pulpo_compaction', id: 'compact-1', retained_turns: [{ role: 'user', content: 'kept' }], summary: 'summary' },
      { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] },
    ]
    const [snapshot] = snapshotResponses([response('00000000-0000-4000-8000-000000000010', { output })])

    expect(snapshot?.output).toMatchObject(output)
    expect(JSON.stringify(snapshot?.output)).toContain('Thought summary')
    expect(JSON.stringify(snapshot?.output)).toContain('"command":"pwd"')
    expect(JSON.stringify(snapshot?.output)).toContain('"output":"/workspace"')
    expect(snapshot).not.toHaveProperty('instructions')
    expect(snapshot).not.toHaveProperty('parameters')
    expect(snapshot).not.toHaveProperty('userId')
  })

  it('collects only generated attachment output items', () => {
    expect(outputAttachmentIds([
      { type: 'pulpo_attachment', attachment_id: 'file-1' },
      { type: 'message', attachment_id: 'not-a-file' },
      { type: 'pulpo_attachment' },
    ])).toEqual(['file-1'])
  })
})
