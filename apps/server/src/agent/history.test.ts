import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { agentRunDisplayState, resolveAgentParentMessages, resumedRunContinues, systemPromptFromAgentContext, withoutMemoryToolMessages, type AgentHistoryResponse } from './history.js'

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
  it('reads a snapshotted system prompt for resumed runs', () => {
    expect(systemPromptFromAgentContext({ systemPrompt: 'original instructions' })).toBe('original instructions')
    expect(systemPromptFromAgentContext({ systemPrompt: 42 })).toBeUndefined()
    expect(systemPromptFromAgentContext({})).toBeUndefined()
  })

  it('restores display bookkeeping saved with a run', () => {
    const archived = [{ role: 'assistant', content: [{ type: 'text', text: 'before compaction' }] }]
    expect(agentRunDisplayState({ messages: [], displayStart: 2, archivedMessages: archived, promptRecorded: true }))
      .toEqual({ displayStart: 2, archivedMessages: archived, promptRecorded: true })
    // Runs saved by older code fall back to the caller's defaults.
    expect(agentRunDisplayState({ messages: [] })).toEqual({ archivedMessages: [], promptRecorded: false })
    expect(agentRunDisplayState({ displayStart: -1, archivedMessages: 'bad', promptRecorded: 'yes' })).toEqual({ archivedMessages: [], promptRecorded: false })
    expect(agentRunDisplayState(null)).toEqual({ archivedMessages: [], promptRecorded: false })
  })

  it('continues a resumed run whose prompt is recorded, even right after compaction', () => {
    // Crash during the first request after a mid-run or recovery compaction: [retained prompt, summary] with displayStart 2.
    const compacted = agentRunDisplayState({ messages: [{}, {}], displayStart: 2, archivedMessages: [], promptRecorded: true })
    expect(resumedRunContinues(compacted, 2, compacted.displayStart!)).toBe(true)
    // Crash before the prompt was recorded, for example right after pre-response compaction.
    const notStarted = agentRunDisplayState({ messages: [{}, {}], displayStart: 2, archivedMessages: [], promptRecorded: false })
    expect(resumedRunContinues(notStarted, 2, notStarted.displayStart!)).toBe(false)
    // Runs saved by older code compare lengths.
    const legacy = agentRunDisplayState({ messages: [{}, {}, {}], displayStart: 2 })
    expect(resumedRunContinues(legacy, 3, legacy.displayStart!)).toBe(true)
    expect(resumedRunContinues(legacy, 2, legacy.displayStart!)).toBe(false)
  })

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
    expect(text(resolved)).toContain('/workspace/attachment-1-chart.png')
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


it('removes memory calls and results from resumed checkpoints while preserving other history', () => {
  const messages = [
    { role: 'user', content: 'Search my chats', timestamp: 1 },
    { role: 'assistant', content: [
      { type: 'toolCall', id: 'memory', name: 'search_chats', arguments: { query: 'private project' } },
      { type: 'toolCall', id: 'workspace', name: 'bash', arguments: { command: 'pwd' } },
    ] },
    { role: 'toolResult', toolCallId: 'memory', toolName: 'search_chats', content: [{ type: 'text', text: 'Captain Violet secret' }] },
    { role: 'toolResult', toolCallId: 'workspace', toolName: 'bash', content: [{ type: 'text', text: '/workspace' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read_chat', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'read', toolName: 'read_chat', content: [{ type: 'text', text: 'secret transcript' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'update_memory', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'write', toolName: 'update_memory', content: [{ type: 'text', text: 'saved secret' }] },
  ] as AgentMessage[]
  const filtered = withoutMemoryToolMessages(messages)
  expect(filtered).toHaveLength(3)
  expect(JSON.stringify(filtered)).not.toMatch(/Captain Violet|secret|search_chats|read_chat|update_memory/)
  expect(JSON.stringify(filtered)).toContain('/workspace')
  expect(JSON.stringify(messages)).toContain('Captain Violet')
})
