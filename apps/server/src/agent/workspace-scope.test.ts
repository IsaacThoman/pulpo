import { describe, expect, it } from 'vitest'
import { canContinueWorkspaceScope } from './workspace-scope.js'

describe('forward workspace history', () => {
  const continuation = { branchReason: 'message', parentResponseId: 'a', activeResponseId: 'a', predecessorStatus: 'completed' }
  it('continues terminal history independently of agent mode', () => {
    for (const predecessorStatus of ['completed', 'failed', 'cancelled', 'incomplete']) {
      expect(canContinueWorkspaceScope({ ...continuation, predecessorStatus })).toBe(true)
    }
    expect(canContinueWorkspaceScope({ branchReason: 'message', parentResponseId: null, activeResponseId: null })).toBe(true)
  })
  it('isolates edits, regenerations, rewinds and unfinished predecessors', () => {
    for (const branchReason of ['regenerate', 'user_edit', 'assistant_edit']) expect(canContinueWorkspaceScope({ ...continuation, branchReason })).toBe(false)
    for (const predecessorStatus of ['queued', 'in_progress', undefined]) expect(canContinueWorkspaceScope({ ...continuation, predecessorStatus })).toBe(false)
    expect(canContinueWorkspaceScope({ ...continuation, parentResponseId: 'older' })).toBe(false)
    expect(canContinueWorkspaceScope({ ...continuation, parentResponseId: null })).toBe(false)
  })
})
