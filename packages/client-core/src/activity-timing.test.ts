import { describe, expect, it } from 'vitest'
import { collapseIntermediateReplies, collapsedWorkDurationMs, initialActivityTiming } from './activity-timing.js'

describe('initial activity timing placement', () => {
  it('assigns the total only to the final initial block, including earlier tool work', () => {
    expect(initialActivityTiming([
      { kind: 'activity', steps: [{ kind: 'tool' }] },
      { kind: 'activity', steps: [{ kind: 'compaction' }] },
      { kind: 'activity', steps: [{ kind: 'reasoning' }] },
      { kind: 'text', text: 'First reply' },
      { kind: 'activity', steps: [{ kind: 'tool' }] },
      { kind: 'text', text: 'Final reply' },
    ])).toEqual({ index: 2, worked: true })
  })
  it('requests a compact label when the first reply has no preceding activity', () => {
    expect(initialActivityTiming([
      { kind: 'text', text: 'Reply' },
      { kind: 'activity', steps: [{ kind: 'tool' }] },
    ])).toEqual({ index: -1, worked: false })
  })
  it('can place terminal timing when cancelled before reply text', () => {
    expect(initialActivityTiming([{ kind: 'activity', steps: [{ kind: 'reasoning' }] }])).toEqual({ index: 0, worked: false })
  })
})

describe('collapsing intermediate replies', () => {
  it('folds interim replies and the work between them into one block before the final reply', () => {
    expect(collapseIntermediateReplies([
      { kind: 'activity', steps: [{ kind: 'reasoning' }], active: false },
      { kind: 'text', text: 'One sec' },
      { kind: 'activity', steps: [{ kind: 'tool' }], active: false },
      { kind: 'text', text: 'Done' },
    ])).toEqual([
      {
        kind: 'activity',
        steps: [{ kind: 'reasoning' }, { kind: 'message', text: 'One sec' }, { kind: 'tool' }],
        active: false,
      },
      { kind: 'text', text: 'Done' },
    ])
  })
  it('folds a leading interim reply that had no work before it', () => {
    expect(collapseIntermediateReplies([
      { kind: 'text', text: 'On it' },
      { kind: 'activity', steps: [{ kind: 'tool' }], active: false },
      { kind: 'text', text: 'Done' },
    ])[0]).toEqual({ kind: 'activity', steps: [{ kind: 'message', text: 'On it' }, { kind: 'tool' }], active: false })
  })
  it('leaves responses without interim replies or without a final reply untouched', () => {
    const plain = [
      { kind: 'activity' as const, steps: [{ kind: 'tool' }], active: false },
      { kind: 'text' as const, text: 'Done' },
    ]
    const unfinished = [
      { kind: 'text' as const, text: 'On it' },
      { kind: 'activity' as const, steps: [{ kind: 'tool' }], active: false },
    ]
    expect(collapseIntermediateReplies(plain)).toBe(plain)
    expect(collapseIntermediateReplies(unfinished)).toBe(unfinished)
  })
})

describe('collapsed work duration', () => {
  const requestReceivedAt = '2026-01-01T00:00:00.000Z'
  it('extends the initial wait to the end of the last timestamped tool', () => {
    expect(collapsedWorkDurationMs([
      { kind: 'reasoning', durationMs: 900 } as { kind: string },
      { kind: 'message' },
      { kind: 'tool', tool: { startedAt: '2026-01-01T00:00:04.000Z', durationMs: 3_000 } } as { kind: string },
      { kind: 'reasoning', durationMs: 500 } as { kind: string },
    ], { requestReceivedAt, initialDurationMs: 2_000 })).toBe(7_500)
  })
  it('sums step durations when timestamps are unavailable', () => {
    expect(collapsedWorkDurationMs([
      { kind: 'tool', tool: { durationMs: 1_000 } } as { kind: string },
      { kind: 'message' },
      { kind: 'tool', tool: { durationMs: 3_000 } } as { kind: string },
    ], { initialDurationMs: undefined })).toBe(4_000)
  })
})
