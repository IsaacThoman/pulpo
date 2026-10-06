import { describe, expect, it } from 'vitest'
import { cascadeDeletionIds, hasOtherResponseVersion, leafAfterDeletion, lineageFromLeaf, metadataForTurn, newestDescendantId, type BranchTurn } from './branching.js'

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

  it('only allows deleting a response version while another version remains', () => {
    expect(hasOtherResponseVersion(turns, turns[1]!)).toBe(true)
    expect(hasOtherResponseVersion(turns, turns[2]!)).toBe(false)
    expect(hasOtherResponseVersion(turns, turns[3]!)).toBe(false)
  })

  it('shows the neighbouring response version after deleting the active one', () => {
    const versions: BranchTurn[] = [
      { id: 'v1', parentResponseId: null, input: originalInput },
      { id: 'v2', parentResponseId: null, input: originalInput },
      { id: 'v3', parentResponseId: null, input: originalInput },
      { id: 'v1-follow-up', parentResponseId: 'v1', input: [{ role: 'user', content: 'Next' }] },
      { id: 'edited', parentResponseId: null, input: editedInput },
    ]
    expect(leafAfterDeletion(versions, versions[1]!, new Set(['v2']), 'v2')).toBe('v1-follow-up')
    expect(leafAfterDeletion(versions, versions[0]!, new Set(['v1', 'v1-follow-up']), 'v1-follow-up')).toBe('v2')
    expect(leafAfterDeletion(versions, versions[1]!, new Set(['v2']), 'edited')).toBe('edited')
  })

  it('falls back to another prompt variant, then the parent, after deleting a user message', () => {
    expect(leafAfterDeletion(turns, turns[0]!, new Set(['first', 'regenerated', 'follow-up']), 'follow-up')).toBe('edited-prompt')
    expect(leafAfterDeletion(turns, turns[3]!, new Set(['follow-up']), 'follow-up')).toBe('regenerated')
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

it('shares indexed assistant groups without letting active user variants overwrite siblings', async () => {
  const { branchMetadataIndex } = await import('./branching.js')
  const lookup = branchMetadataIndex(turns)
  const first = lookup(turns[0]!)
  const regenerated = lookup(turns[1]!)
  expect(first.user.ids).toEqual(['first', 'edited-prompt'])
  expect(regenerated.user.ids).toEqual(['regenerated', 'edited-prompt'])
  expect(first.assistant.ids).toBe(regenerated.assistant.ids)
})

it('handles a deep lineage and malformed descendant cycles without recursion or repeated array shifts', () => {
  const deep = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null, input: [] }))
  expect(lineageFromLeaf(deep, '19999')).toEqual(deep)
  expect(newestDescendantId(deep, '0')).toBe('19999')
  expect(newestDescendantId([{ id: 'a', parentResponseId: 'b', input: [] }, { id: 'b', parentResponseId: 'a', input: [] }], 'a')).toBe('b')
})
