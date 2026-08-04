import { describe, expect, it } from 'vitest'
import { buildMessageTimeline } from './timeline'

describe('buildMessageTimeline', () => {
  it('preserves reasoning, tools, and assistant turns in server order', () => {
    const timeline = buildMessageTimeline([
      { type: 'reasoning', status: 'completed', summary: [{ text: 'Plan **A**' }], durationMs: 800 },
      { type: 'message', content: [{ text: 'First answer' }] },
      { type: 'pulpo_tool', id: 'tool-1', tool: 'read', status: 'completed', output: 'done' },
      { type: 'message', content: [{ text: 'Final answer' }] },
    ], true)
    expect(timeline).toMatchObject([
      { kind: 'activity', steps: [{ kind: 'reasoning', text: 'Plan **A**' }] },
      { kind: 'text', text: 'First answer' },
      { kind: 'activity', steps: [{ kind: 'tool', tool: { id: 'tool-1' } }] },
      { kind: 'text', text: 'Final answer' },
    ])
  })

  it('keeps work visible when reasoning is hidden', () => {
    const timeline = buildMessageTimeline([
      { type: 'reasoning', status: 'in_progress', summary: [{ text: 'secret' }] },
      { type: 'pulpo_workspace', state: 'waiting', position: 2 },
    ], false)
    expect(timeline).toMatchObject([{ kind: 'activity', active: true, steps: [{ kind: 'workspace', workspace: { position: 2 } }] }])
  })

  it('preserves context compaction as its own activity between assistant turns', () => {
    const timeline = buildMessageTimeline([
      { type: 'message', content: [{ text: 'Before compaction' }] },
      {
        id: 'compact-1', type: 'pulpo_compaction', phase: 'pre_response', status: 'completed',
        model_id: 'gpt-5', estimated_tokens: 120_000, threshold_tokens: 100_000,
        retained_turns: [{ role: 'user', content: 'Keep this' }], retained_context: [],
        retained_context_turns: [], summary: 'Earlier **summary**',
        started_at: '2026-08-04T12:00:00.000Z', duration_ms: 900,
      },
      { type: 'message', content: [{ text: 'After compaction' }] },
    ], true)

    expect(timeline).toMatchObject([
      { kind: 'text', text: 'Before compaction' },
      {
        kind: 'activity', active: false,
        steps: [{ kind: 'compaction', compaction: { id: 'compact-1', summary: 'Earlier **summary**' } }],
      },
      { kind: 'text', text: 'After compaction' },
    ])
  })
})
