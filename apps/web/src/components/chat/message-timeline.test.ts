import { describe, expect, it } from 'vitest'
import { activityDurationMs } from './activity-timing'
import { buildTimeline, type ActivitySegment } from './message-timeline'

function reasoning(text: string, options: { active?: boolean; durationMs?: number } = {}) {
  return {
    type: 'reasoning',
    status: options.active ? 'in_progress' : 'completed',
    summary: [{ type: 'summary_text', text }],
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  }
}

function message(text: string, status = 'completed') {
  return {
    type: 'message',
    role: 'assistant',
    status,
    content: [{ type: 'output_text', text }],
  }
}

function tool(id: string, options: { running?: boolean; durationMs?: number } = {}) {
  return {
    type: 'pulpo_tool',
    id,
    tool: 'bash',
    status: options.running ? 'running' : 'completed',
    output: '',
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  }
}

function onlyActivity(output: unknown[], showReasoning = true): ActivitySegment {
  const timeline = buildTimeline(output, showReasoning)
  expect(timeline).toHaveLength(1)
  expect(timeline[0]?.kind).toBe('activity')
  return timeline[0] as ActivitySegment
}

describe('buildTimeline', () => {
  it('merges activity separated by empty assistant messages', () => {
    const activity = onlyActivity([
      reasoning('Inspect the file.'),
      tool('read'),
      message(''),
      reasoning('Make the change.'),
      tool('edit'),
    ])

    expect(activity.steps.map((step) => step.kind)).toEqual([
      'reasoning',
      'tool',
      'reasoning',
      'tool',
    ])
  })

  it('ignores whitespace-only and repeated empty message parts', () => {
    const activity = onlyActivity([
      tool('first'),
      message('  \n\t'),
      { type: 'message', role: 'assistant', status: 'completed', content: '' },
      message(''),
      tool('second'),
    ])

    expect(activity.steps.map((step) => step.kind === 'tool' ? step.tool.id : step.kind)).toEqual([
      'first',
      'second',
    ])
  })

  it('preserves visible commentary as an activity boundary', () => {
    const timeline = buildTimeline([
      reasoning('Inspect.'),
      tool('read'),
      message('The file looks good.'),
      reasoning('Verify.'),
      tool('test'),
    ], true)

    expect(timeline.map((segment) => segment.kind)).toEqual(['activity', 'text', 'activity'])
    expect(timeline[1]).toEqual({ kind: 'text', text: 'The file looks good.' })
  })

  it('keeps activity live across an empty streaming text placeholder', () => {
    const activity = onlyActivity([
      reasoning('Still working.', { active: true }),
      message('', 'in_progress'),
    ])

    expect(activity.active).toBe(true)
    expect(activity.steps).toHaveLength(1)
  })

  it('turns a streaming placeholder into a boundary once visible text arrives', () => {
    const timeline = buildTimeline([
      reasoning('Finished thinking.'),
      message('Starting the answer.', 'in_progress'),
      tool('follow-up', { running: true }),
    ], true)

    expect(timeline.map((segment) => segment.kind)).toEqual(['activity', 'text', 'activity'])
    expect(timeline[2]).toMatchObject({ kind: 'activity', active: true })
  })

  it('merges hidden reasoning with tools without exposing reasoning steps', () => {
    const activity = onlyActivity([
      reasoning('Private summary.'),
      message(''),
      tool('run'),
    ], false)

    expect(activity.steps.map((step) => step.kind)).toEqual(['tool'])
  })

  it('places one workspace step before the first tool in merged activity', () => {
    const activity = onlyActivity([
      { type: 'pulpo_workspace', state: 'ready', durationMs: 400 },
      reasoning('Prepare.'),
      tool('first'),
      message(''),
      tool('second'),
    ])

    expect(activity.steps.map((step) => step.kind)).toEqual([
      'reasoning',
      'workspace',
      'tool',
      'tool',
    ])
    expect(activity.steps.filter((step) => step.kind === 'workspace')).toHaveLength(1)
  })

  it('aggregates timing from every merged step', () => {
    const activity = onlyActivity([
      reasoning('Prepare.', { durationMs: 1_000 }),
      tool('first', { durationMs: 2_000 }),
      message(''),
      reasoning('Check.', { durationMs: 500 }),
      tool('second', { durationMs: 1_500 }),
    ])

    expect(activityDurationMs(activity.steps)).toBe(5_000)
  })

  it('shows compaction independently of reasoning visibility and preserves its timeline position', () => {
    const compaction = {
      id: 'compact-1', type: 'pulpo_compaction', phase: 'pre_response', status: 'completed',
      model_id: 'hidden-model', estimated_tokens: 110_000, threshold_tokens: 100_000,
      retained_turns: [{ role: 'user', content: 'kept exactly' }], retained_context: [], retained_context_turns: [],
      summary: 'Earlier context', started_at: new Date(0).toISOString(), duration_ms: 500,
    }
    const timeline = buildTimeline([compaction, reasoning('hidden'), message('Answer')], false)
    expect(timeline.map((segment) => segment.kind)).toEqual(['activity', 'text'])
    const activity = timeline[0] as ActivitySegment
    expect(activity.steps).toEqual([{ kind: 'compaction', compaction }])
    expect(activityDurationMs(activity.steps)).toBe(500)
  })
})
