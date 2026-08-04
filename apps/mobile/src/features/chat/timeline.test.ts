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
})
