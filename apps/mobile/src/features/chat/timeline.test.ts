import { describe, expect, it } from 'vitest'
import { buildLegacyMessageTimeline, buildMessageTimeline, completedActivityLabel, timelineActivityIsActive } from './timeline'

describe('buildMessageTimeline', () => {
  it('ignores empty active reasoning while ordinary answer text streams', () => {
    expect(buildMessageTimeline([
      { type: 'reasoning', status: 'in_progress', summary: [{ text: '   ' }] },
      { type: 'message', status: 'in_progress', content: [{ text: 'Answer in progress' }] },
    ], true)).toEqual([{ kind: 'text', text: 'Answer in progress' }])
  })

  it('shows active reasoning after reasoning text is emitted', () => {
    const timeline = buildMessageTimeline([
      { type: 'reasoning', status: 'in_progress', summary: [{ text: 'Checking constraints' }] },
    ], true)
    expect(timeline).toMatchObject([{
      kind: 'activity',
      active: true,
      steps: [{ kind: 'reasoning', text: 'Checking constraints', active: true }],
    }])
    expect(timelineActivityIsActive(timeline, 0, true)).toBe(true)
  })

  it('ends stale reasoning activity as soon as streamed answer text is visible', () => {
    const timeline = buildMessageTimeline([
      { type: 'reasoning', status: 'in_progress', summary: [{ text: 'Finished thinking' }] },
      { type: 'message', status: 'in_progress', content: [{ text: 'Answer in progress' }] },
    ], true)

    expect(timeline).toMatchObject([
      { kind: 'activity', active: true },
      { kind: 'text', text: 'Answer in progress' },
    ])
    expect(timelineActivityIsActive(timeline, 0, true)).toBe(false)
  })

  it('only lets trailing work remain active across multiple agent phases', () => {
    const timeline = buildMessageTimeline([
      { type: 'reasoning', status: 'in_progress', summary: [{ text: 'First thought' }] },
      { type: 'message', status: 'in_progress', content: [{ text: 'Interim answer' }] },
      { type: 'reasoning', status: 'in_progress', summary: [{ text: 'Follow-up thought' }] },
    ], true)

    expect(timeline.map((segment) => segment.kind)).toEqual(['activity', 'text', 'activity'])
    expect(timelineActivityIsActive(timeline, 0, true)).toBe(false)
    expect(timelineActivityIsActive(timeline, 2, true)).toBe(true)
  })

  it('applies response streaming only as a fallback for the final activity', () => {
    const timeline = buildMessageTimeline([
      { type: 'reasoning', status: 'completed', summary: [{ text: 'First thought' }] },
      {
        id: 'compact-1', type: 'pulpo_compaction', phase: 'pre_response', status: 'completed',
        model_id: 'gpt-5', estimated_tokens: 120_000, threshold_tokens: 100_000,
        retained_turns: [], retained_context: [], retained_context_turns: [], summary: 'Summary',
        started_at: '2026-08-04T12:00:00.000Z', duration_ms: 900,
      },
    ], true)

    expect(timeline.map((segment) => segment.kind)).toEqual(['activity', 'activity'])
    expect(timelineActivityIsActive(timeline, 0, true)).toBe(false)
    expect(timelineActivityIsActive(timeline, 1, true)).toBe(true)
  })

  it('matches desktop labels for completed thought and work durations', () => {
    expect(completedActivityLabel([
      { kind: 'reasoning', text: 'Checked constraints', active: false },
    ], 2_400)).toBe('Thought for 2s')
    expect(completedActivityLabel([
      { kind: 'reasoning', text: 'Planned work', active: false, durationMs: 1_000 },
      { kind: 'tool', tool: { type: 'pulpo_tool', status: 'completed', durationMs: 2_500 } },
    ])).toBe('Worked for 4s')
  })

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

describe('buildLegacyMessageTimeline', () => {
  it('does not manufacture thinking activity for an ordinary stream', () => {
    expect(buildLegacyMessageTimeline({
      reasoning: undefined,
      text: '',
      streaming: true,
      showReasoning: true,
    })).toEqual([])
  })

  it('ignores an empty legacy reasoning placeholder', () => {
    expect(buildLegacyMessageTimeline({
      reasoning: '',
      text: '',
      streaming: true,
      showReasoning: true,
    })).toEqual([])
  })

  it('shows legacy reasoning once text is emitted', () => {
    expect(buildLegacyMessageTimeline({
      reasoning: 'Checking constraints',
      text: '',
      streaming: true,
      showReasoning: true,
    })).toMatchObject([{
      kind: 'activity',
      active: true,
      steps: [{ kind: 'reasoning', text: 'Checking constraints', active: true }],
    }])
  })

  it('keeps completed reasoning ahead of the response body', () => {
    expect(buildLegacyMessageTimeline({
      reasoning: 'Checked the constraints',
      text: 'Final answer',
      streaming: false,
      showReasoning: true,
      reasoningDurationMs: 900,
    })).toMatchObject([
      { kind: 'activity', active: false, steps: [{ kind: 'reasoning', text: 'Checked the constraints', durationMs: 900 }] },
      { kind: 'text', text: 'Final answer' },
    ])
  })
})
