import { describe, expect, it } from 'vitest'
import { BranchSelectionIntents } from './branch-selection-intents'

describe('branch selection intents', () => {
  it('does not let an older selection clear a newer selection of the same leaf', () => {
    const intents = new BranchSelectionIntents()
    const regeneration = intents.select('chat', 'branch-b')
    const back = intents.select('chat', 'branch-a')
    const forward = intents.select('chat', 'branch-b')

    expect(intents.clear('chat', regeneration.version)).toBe(false)
    expect(intents.isCurrent('chat', back.version)).toBe(false)
    expect(intents.current('chat')).toEqual(forward)
    expect(intents.clear('chat', forward.version)).toBe(true)
  })

  it('keeps versions increasing after the current intent is cleared', () => {
    const intents = new BranchSelectionIntents()
    const first = intents.select('chat', 'branch-a')
    intents.clear('chat', first.version)

    expect(intents.select('chat', 'branch-a').version).toBeGreaterThan(first.version)
  })
})
