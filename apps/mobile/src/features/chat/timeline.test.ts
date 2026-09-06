import { describe, expect, it } from 'vitest'
import { recalledChatLabel } from './recall-label'
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

  it('groups recalled sources with subsequent work and labels the disclosure', () => {
    const timeline = buildMessageTimeline([{
      id: 'response-1:recall', type: 'pulpo_recall', status: 'completed',
      sources: [{
        chat_id: '00000000-0000-4000-8000-000000000001',
        response_id: '00000000-0000-4000-8000-000000000002',
        title: 'Earlier architecture chat', updated_at: '2026-08-27T00:00:00.000Z',
        excerpt: 'Use a parallel index generation during model changes.',
      }],
    }, { type: 'pulpo_tool', id: 'tool-1', status: 'completed' }, { type: 'message', content: [{ text: 'Answer' }] }], true)
    const activity = timeline[0]

    expect(activity).toMatchObject({ kind: 'activity', steps: [{ kind: 'recall' }, { kind: 'tool' }] })
    if (activity?.kind !== 'activity') throw new Error('Expected recall activity')
    expect(completedActivityLabel(activity.steps)).toBe('Worked')
    expect(completedActivityLabel([activity.steps[0]!])).toBe('Recalled from 1 chat')
    expect(completedActivityLabel([
      activity.steps[0]!,
      { kind: 'reasoning', text: 'Checked recalled context', active: false },
    ])).toBe('Thought')
    expect(recalledChatLabel(2)).toBe('Recalled from 2 chats')
  })

  it.each([
    { type: 'reasoning', status: 'completed', summary: [{ text: 'Private summary' }] },
    { type: 'reasoning', status: 'in_progress', summary: [{ text: 'Thinking' }] },
    { type: 'pulpo_tool', tool: 'bash', status: 'completed', output: 'Tool output' },
    { type: 'pulpo_tool', tool: 'bash', status: 'running' },
    { type: 'pulpo_workspace', state: 'ready' },
    { type: 'pulpo_workspace', state: 'waiting', position: 2 },
    { type: 'pulpo_recall', status: 'completed', sources: [] },
    { type: 'pulpo_compaction', status: 'completed', summary: 'Context summary' },
    { type: 'pulpo_compaction', status: 'in_progress' },
  ])('hides $type activity ($status $state) when reasoning is off', (item) => {
    expect(buildMessageTimeline([item], false)).toEqual([])
    expect(buildMessageTimeline([
      { type: 'message', content: [{ text: 'Before work' }] },
      item,
      { type: 'message', content: [{ text: 'Answer' }] },
    ], false)).toEqual([
      { kind: 'text', text: 'Before work' },
      { kind: 'text', text: 'Answer' },
    ])
    expect(buildMessageTimeline([item], true)).toMatchObject([{ kind: 'activity' }])
  })

  it('hides a whole work sequence while preserving assistant text and stored output', () => {
    const output = [
      { type: 'pulpo_workspace', state: 'ready' },
      { type: 'pulpo_recall', status: 'completed', sources: [] },
      { type: 'reasoning', status: 'completed', summary: [{ text: 'Plan' }] },
      { type: 'pulpo_tool', tool: 'bash', status: 'completed', output: 'Done' },
      { type: 'message', content: [{ text: 'First answer' }] },
      { type: 'pulpo_compaction', status: 'completed', summary: 'Context' },
      { type: 'pulpo_tool', tool: 'bash', status: 'running' },
      { type: 'message', status: 'in_progress', content: [{ text: 'Final answer' }] },
    ]
    const visible = buildMessageTimeline(output, true)
    expect(buildMessageTimeline(output, false)).toEqual([
      { kind: 'text', text: 'First answer' },
      { kind: 'text', text: 'Final answer' },
    ])
    expect(buildMessageTimeline(output, true)).toEqual(visible)
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
  it.each([false, true])('hides cached reasoning when streaming is %s', (streaming) => {
    expect(buildLegacyMessageTimeline({
      reasoning: 'Private summary',
      text: 'Answer',
      streaming,
      showReasoning: false,
    })).toEqual([{ kind: 'text', text: 'Answer' }])
  })

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
