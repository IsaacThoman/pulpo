import { describe, expect, it } from 'vitest'
import { nextComposerToolbarFit } from './use-composer-toolbar-fit'

describe('composer toolbar fit', () => {
  it('collapses the agent menu before the presets, one step at a time', () => {
    expect(nextComposerToolbarFit(0, { overflow: 12, slack: 0, saved: undefined, maxFit: 2 })).toBe(1)
    expect(nextComposerToolbarFit(1, { overflow: 12, slack: 0, saved: 90, maxFit: 2 })).toBe(2)
    expect(nextComposerToolbarFit(2, { overflow: 12, slack: 0, saved: 70, maxFit: 2 })).toBe(2)
  })

  it('stops at the agent menu when there are no presets', () => {
    expect(nextComposerToolbarFit(1, { overflow: 12, slack: 0, saved: 90, maxFit: 1 })).toBe(1)
  })

  it('expands only once the free space covers what the last step saved', () => {
    expect(nextComposerToolbarFit(2, { overflow: 0, slack: 69, saved: 70, maxFit: 2 })).toBe(2)
    expect(nextComposerToolbarFit(2, { overflow: 0, slack: 71, saved: 70, maxFit: 2 })).toBe(1)
    expect(nextComposerToolbarFit(1, { overflow: 0, slack: 120, saved: 90, maxFit: 2 })).toBe(0)
  })

  it('ignores sub-pixel rounding', () => {
    expect(nextComposerToolbarFit(0, { overflow: 0.3, slack: 0, saved: undefined, maxFit: 2 })).toBe(0)
    expect(nextComposerToolbarFit(1, { overflow: 0, slack: 90.2, saved: 90, maxFit: 2 })).toBe(1)
  })

  it('stays put without a recorded width to expand back into', () => {
    expect(nextComposerToolbarFit(1, { overflow: 0, slack: 500, saved: undefined, maxFit: 2 })).toBe(1)
  })
})
