import { describe, expect, it } from 'vitest'
import { buildAgentOutput, type ToolTimelineItem } from './timeline.js'

describe('buildAgentOutput', () => {
  it('keeps recalled chats before agent work in persisted output', () => {
    const recall = {
      id: 'response:recall', type: 'pulpo_recall' as const, status: 'completed' as const,
      sources: [{
        chat_id: '10000000-0000-4000-8000-000000000001',
        response_id: '20000000-0000-4000-8000-000000000001',
        title: 'Earlier chat', updated_at: '2026-08-27T00:00:00.000Z', excerpt: 'Relevant detail',
      }],
    }
    const output = buildAgentOutput({ messages: [], skipMessageCount: 0, toolItems: new Map(), recallItems: [recall] })
    expect(output[0]).toEqual(recall)
  })

  it('interleaves reasoning, text, and tools across turns', () => {
    const tools = new Map<string, ToolTimelineItem>([
      ['t1', { id: 't1', type: 'pulpo_tool', tool: 'bash', arguments: { command: 'ping' }, status: 'completed', output: 'ok', durationMs: 1200 }],
      ['t2', { id: 't2', type: 'pulpo_tool', tool: 'bash', arguments: { command: 'curl' }, status: 'completed', output: '200', durationMs: 800 }],
    ])
    const output = buildAgentOutput({
      skipMessageCount: 0,
      toolItems: tools,
      turnDurationsMs: new Map([[1, 4500], [2, 2100]]),
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need bash.' },
            { type: 'text', text: 'Trying ping.' },
            { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ping' } },
          ],
        } as never,
        {
          role: 'toolResult',
          toolCallId: 't1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
          timestamp: 0,
        } as never,
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Use curl.' },
            { type: 'toolCall', id: 't2', name: 'bash', arguments: { command: 'curl' } },
          ],
        } as never,
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
        } as never,
      ],
      terminal: true,
    })

    expect(output.map((item) => (item as { type?: string }).type)).toEqual([
      'reasoning',
      'message',
      'pulpo_tool',
      'reasoning',
      'pulpo_tool',
      'message',
    ])
    expect((output[0] as { durationMs?: number }).durationMs).toBe(4500)
    expect((output[1] as { content: Array<{ text: string }> }).content[0]?.text).toBe('Trying ping.')
    expect((output[2] as { durationMs?: number }).durationMs).toBe(1200)
    expect((output[3] as { durationMs?: number }).durationMs).toBe(2100)
    expect((output[5] as { content: Array<{ text: string }> }).content[0]?.text).toBe('Done.')
  })

  it('skips inherited parent messages and marks the streaming tail', () => {
    const output = buildAgentOutput({
      skipMessageCount: 1,
      toolItems: new Map(),
      streaming: true,
      messages: [
        { role: 'user', content: 'old', timestamp: 0 } as never,
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'new' },
          ],
        } as never,
      ],
    })
    expect(output.map((item) => (item as { type?: string }).type)).toEqual([
      'reasoning',
      'message',
    ])
    expect((output[0] as { status?: string }).status).toBe('in_progress')
    expect((output[1] as { status?: string }).status).toBe('in_progress')
  })

  it('omits empty thinking placeholders while preserving emitted reasoning', () => {
    const output = buildAgentOutput({
      skipMessageCount: 0,
      toolItems: new Map(),
      streaming: true,
      turnDurationsMs: new Map([[1, 750]]),
      messages: [{
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '   ' },
          { type: 'thinking', thinking: 'Actual reasoning' },
          { type: 'text', text: 'Answer' },
        ],
      } as never],
    })

    expect(output).toMatchObject([
      { type: 'reasoning', summary: [{ text: 'Actual reasoning' }], durationMs: 750 },
      { type: 'message', content: [{ text: 'Answer' }] },
    ])
  })

  it('places an attached file immediately after its tool call', () => {
    const output = buildAgentOutput({
      skipMessageCount: 0,
      toolItems: new Map([['attach-1', { id: 'attach-1', type: 'pulpo_tool', tool: 'attach_file', arguments: { path: '/workspace/a.pdf' }, status: 'completed', output: 'Attached a.pdf' }]]),
      attachmentItems: new Map([['attach-1', { type: 'pulpo_attachment', attachment_id: 'file-1', name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 12, status: 'completed' }]]),
      messages: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'attach-1', name: 'attach_file', arguments: { path: '/workspace/a.pdf' } }] } as never],
      terminal: true,
    })
    expect(output.map((item) => (item as { type?: string }).type)).toEqual(['pulpo_tool', 'pulpo_attachment'])
  })

  it('keeps pre-response and mid-run compaction activities in model-turn order', () => {
    const base = {
      type: 'pulpo_compaction' as const, status: 'completed' as const, model_id: 'model',
      estimated_tokens: 200_000, threshold_tokens: 100_000, retained_turns: [], retained_context: [], retained_context_turns: [],
      summary: 'summary', started_at: new Date(0).toISOString(),
    }
    const output = buildAgentOutput({
      skipMessageCount: 0,
      toolItems: new Map(),
      compactionItems: [
        { ...base, id: 'pre', phase: 'pre_response' },
        { ...base, id: 'mid', phase: 'agent_mid_run', before_agent_turn: 2 },
      ],
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'First.' }] } as never,
        { role: 'assistant', content: [{ type: 'text', text: 'Second.' }] } as never,
      ],
      terminal: true,
    })
    expect(output.map((item) => (item as { type?: string }).type === 'pulpo_compaction'
      ? (item as { id?: string }).id
      : (item as { type?: string }).type)).toEqual([
      'pre', 'message', 'mid', 'message',
    ])
  })
})
