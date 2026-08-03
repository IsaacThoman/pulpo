import { describe, expect, it } from 'vitest'
import { planDuplicateTree } from './duplicate.js'

describe('chat duplication', () => {
  it('remaps response branches and preserves assistant variants for one user message', () => {
    let id = 0
    const plan = planDuplicateTree([
      { id: 'root-a', parentResponseId: null, previousResponseId: null, userMessageId: 'prompt-1' },
      { id: 'root-b', parentResponseId: null, previousResponseId: null, userMessageId: 'prompt-1' },
      { id: 'child', parentResponseId: 'root-b', previousResponseId: 'root-b', userMessageId: 'prompt-2' },
    ], () => `new-${++id}`)
    const alternate = plan.remap({
      id: 'root-b', parentResponseId: null, previousResponseId: null, userMessageId: 'prompt-1',
    })
    const child = plan.remap({
      id: 'child', parentResponseId: 'root-b', previousResponseId: 'root-b', userMessageId: 'prompt-2',
    })
    expect(alternate.userMessageId).toBe(plan.remap({
      id: 'root-a', parentResponseId: null, previousResponseId: null, userMessageId: 'prompt-1',
    }).userMessageId)
    expect(child.parentResponseId).toBe(alternate.id)
    expect(child.previousResponseId).toBe(alternate.id)
  })
})
