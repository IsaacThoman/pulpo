import { describe, expect, it } from 'vitest'
import { collapseMessageTimeline } from './collapse-message-timeline.js'

type Step = { kind: 'reasoning' | 'tool' | 'compaction'; durationMs?: number }
const activity = (kind: Step['kind'], durationMs?: number, active = false) => ({
  kind: 'activity' as const, steps: [{ kind, durationMs }], active,
})
const text = (text: string) => ({ kind: 'text' as const, text })
const duration = (steps: Step[]) => steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0)

describe('collapseMessageTimeline', () => {
  it('preserves order and source data while grouping everything before final text', () => {
    const input = [activity('reasoning', 1000), text('Progress'), activity('tool', 2000), text('Answer')]
    const before = structuredClone(input)
    expect(collapseMessageTimeline(input, duration)).toEqual([
      { kind: 'activity', active: false, durationMs: 3000, steps: [
        { kind: 'reasoning', durationMs: 1000 }, { kind: 'message', text: 'Progress' }, { kind: 'tool', durationMs: 2000 },
      ] }, text('Answer'),
    ])
    expect(input).toEqual(before)
  })

  it('moves provisional text into work when activity resumes, then reveals new text', () => {
    const input = [activity('reasoning', 1000, true), text('Checking')]
    expect(collapseMessageTimeline(input, duration).at(-1)).toEqual(text('Checking'))
    const resumed = [...input, activity('tool', undefined, true)]
    expect(collapseMessageTimeline(resumed, duration)).toMatchObject([
      { kind: 'activity', active: true, steps: [{ kind: 'reasoning' }, { kind: 'message', text: 'Checking' }, { kind: 'tool' }] },
    ])
    expect(collapseMessageTimeline([...resumed, text('Answer')], duration)).toMatchObject([
      { kind: 'activity', active: false }, text('Answer'),
    ])
  })

  it('counts the initial server wait once across compaction and reasoning, plus later work', () => {
    const input = [activity('compaction', 500), activity('reasoning', 1500), text('Progress'), activity('tool', 4000), text('Answer')]
    expect(collapseMessageTimeline(input, duration, 10000)[0]).toMatchObject({ durationMs: 14000 })
  })

  it('groups consecutive assistant messages and leaves text-only replies alone', () => {
    expect(collapseMessageTimeline([text('Answer')], duration)).toEqual([text('Answer')])
    expect(collapseMessageTimeline([], duration)).toEqual([])
    expect(collapseMessageTimeline([text('First'), text('Second'), text('Final')], duration)).toMatchObject([
      { kind: 'activity', steps: [{ kind: 'message', text: 'First' }, { kind: 'message', text: 'Second' }] }, text('Final'),
    ])
  })

  it('does not manufacture final text when a stopped or failed response ends with work', () => {
    expect(collapseMessageTimeline([text('Trying'), activity('tool')], duration)).toMatchObject([
      { kind: 'activity', steps: [{ kind: 'message', text: 'Trying' }, { kind: 'tool' }] },
    ])
  })
})
