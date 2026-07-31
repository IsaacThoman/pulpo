import { describe, expect, it } from 'vitest'
import { lineageFromLeaf, metadataForTurn, newestDescendantId, type BranchTurn } from './branching.js'

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

  it('returns only the selected lineage for display and sharing', () => {
    expect(lineageFromLeaf(turns, 'follow-up').map((turn) => turn.id)).toEqual(['regenerated', 'follow-up'])
    expect(lineageFromLeaf(turns, 'edited-prompt').map((turn) => turn.id)).toEqual(['edited-prompt'])
  })
})
