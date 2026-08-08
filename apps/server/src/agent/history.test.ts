import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { resolveAgentParentMessages, type AgentHistoryResponse } from './history.js'

const now = new Date('2026-08-08T12:00:00.000Z')

function response(input: Partial<AgentHistoryResponse> & Pick<AgentHistoryResponse, 'id'>): AgentHistoryResponse {
  return {
    status: 'completed',
    modelId: 'model',
    input: [{ role: 'user', content: [{ type: 'input_text', text: input.id }] }],
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `answer ${input.id}` }] }],
    createdAt: now,
    completedAt: now,
    ...input,
  }
}

function text(messages: AgentMessage[]): string {
  return JSON.stringify(messages)
}

describe('Agent parent history', () => {
  it('uses the immediate parent Agent context unchanged', () => {
    const persisted = [{ role: 'user', content: 'existing', timestamp: 1 }] as AgentMessage[]
    expect(resolveAgentParentMessages(
      [response({ id: 'parent' })],
      new Map([['parent', { messages: persisted }]]),
    )).toEqual(persisted)
  })

  it('replays an edited assistant branch after the newest persisted context', () => {
    const persisted = [
      { role: 'user', content: 'image prompt', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'image answer' }] },
    ] as AgentMessage[]
    const edited = response({
      id: 'edited',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'original user turn' }] }],
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'discard me' }] },
        { type: 'pulpo_tool', tool: 'bash', output: 'discard me too' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'edited answer' }] },
      ],
    })

    const resolved = resolveAgentParentMessages(
      [response({ id: 'prior' }), edited],
      new Map([['prior', { messages: persisted }]]),
    )

    expect(text(resolved)).toContain('image prompt')
    expect(text(resolved)).toContain('original user turn')
    expect(text(resolved)).toContain('edited answer')
    expect(text(resolved)).not.toContain('discard me')
  })

  it('replays an edited first response and reconstructs its attachment manifest', () => {
    const edited = response({
      id: 'edited',
      input: [{ role: 'user', content: [
        { type: 'input_text', text: 'inspect this' },
        { type: 'input_file', attachment_id: 'attachment-1' },
      ] }],
    })
    const resolved = resolveAgentParentMessages([edited], new Map(), new Map([['attachment-1', {
      id: 'attachment-1', originalName: 'chart.png', mimeType: 'image/png', sizeBytes: 123,
    }]]))

    expect(text(resolved)).toContain('inspect this')
    expect(text(resolved)).toContain('chart.png')
    expect(text(resolved)).toContain('/workspace/attachme-chart.png')
    expect(text(resolved)).toContain('answer edited')
  })

  it('replays consecutive responses without Agent runs', () => {
    const resolved = resolveAgentParentMessages(
      [response({ id: 'one' }), response({ id: 'two' })],
      new Map(),
    )
    expect(text(resolved)).toContain('one')
    expect(text(resolved)).toContain('answer one')
    expect(text(resolved)).toContain('two')
    expect(text(resolved)).toContain('answer two')
  })

  it('keeps resolved history when a replayed response has malformed output', () => {
    const persisted = [{ role: 'user', content: 'keep me', timestamp: 1 }] as AgentMessage[]
    const resolved = resolveAgentParentMessages(
      [response({ id: 'prior' }), response({ id: 'broken', output: [{ type: 'message', content: null }] })],
      new Map([['prior', { messages: persisted }]]),
    )
    expect(text(resolved)).toContain('keep me')
    expect(text(resolved)).toContain('broken')
  })

  it('ignores an empty malformed context instead of erasing an earlier checkpoint', () => {
    const persisted = [{ role: 'user', content: 'keep checkpoint', timestamp: 1 }] as AgentMessage[]
    const resolved = resolveAgentParentMessages(
      [response({ id: 'prior' }), response({ id: 'empty' })],
      new Map([['prior', { messages: persisted }], ['empty', {}]]),
    )
    expect(text(resolved)).toContain('keep checkpoint')
    expect(text(resolved)).toContain('answer empty')
  })
})
