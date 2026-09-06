import { describe, expect, it } from 'vitest'
import { initialActivityTiming } from './activity-timing.js'

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
