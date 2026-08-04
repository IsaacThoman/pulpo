import { describe, expect, it } from 'vitest'
import { cascadeDeletionIds, lineageFromLeaf, metadataForTurn, newestDescendantId, type BranchTurn } from './branching.js'

const originalInput = [{ role: 'user', content: 'Original prompt' }]
const editedInput = [{ role: 'user', content: 'Edited prompt' }]
const turns: BranchTurn[] = [
  { id: 'first', parentResponseId: null, input: originalInput },
  { id: 'regenerated', parentResponseId: null, input: originalInput },
  { id: 'edited-prompt', parentResponseId: null, input: editedInput },
  { id: 'follow-up', parentResponseId: 'regenerated', input: [{ role: 'user', content: 'Next' }] },
]

describe('response branches', () => {
  it('separates prompt branches from generations of the same prompt', () => {
    expect(metadataForTurn(turns, turns[1]!)).toEqual({
      user: { ids: ['regenerated', 'edited-prompt'], index: 0 },
      assistant: { ids: ['first', 'regenerated'], index: 1 },
    })
  })

  it('selects the active response for its prompt branch', () => {
    expect(metadataForTurn(turns, turns[0]!).user).toEqual({ ids: ['first', 'edited-prompt'], index: 0 })
  })

  it('continues down the newest saved lineage when activating an ancestor', () => {
    expect(newestDescendantId(turns, 'regenerated')).toBe('follow-up')
    expect(newestDescendantId(turns, 'edited-prompt')).toBe('edited-prompt')
  })

  it('cascades assistant deletion without removing its sibling response', () => {
    expect([...cascadeDeletionIds(turns, turns[1]!, false)]).toEqual(['regenerated', 'follow-up'])
  })

  it('cascades a user-message variant across its regenerated responses', () => {
    expect([...cascadeDeletionIds(turns, turns[0]!, true)]).toEqual(['first', 'regenerated', 'follow-up'])
  })

  it('returns only the selected lineage for display and sharing', () => {
    expect(lineageFromLeaf(turns, 'follow-up').map((turn) => turn.id)).toEqual(['regenerated', 'follow-up'])
    expect(lineageFromLeaf(turns, 'edited-prompt').map((turn) => turn.id)).toEqual(['edited-prompt'])
  })

  it('keeps identical user-message edits as separate user branches', () => {
    const identical: BranchTurn[] = [
      { id: 'answer-1', parentResponseId: null, userMessageId: 'user-1', input: originalInput },
      { id: 'answer-2', parentResponseId: null, userMessageId: 'user-1', input: originalInput },
      { id: 'answer-3', parentResponseId: null, userMessageId: 'user-2', input: originalInput },
    ]
    expect(metadataForTurn(identical, identical[1]!)).toEqual({
      user: { ids: ['answer-2', 'answer-3'], index: 0 },
      assistant: { ids: ['answer-1', 'answer-2'], index: 1 },
    })
    expect(metadataForTurn(identical, identical[2]!)).toEqual({
      user: { ids: ['answer-2', 'answer-3'], index: 1 },
      assistant: { ids: ['answer-3'], index: 0 },
    })
  })
})
