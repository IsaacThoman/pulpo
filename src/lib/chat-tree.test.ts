import { describe, expect, it } from 'vitest'
import { lineageFromLeaf, newestDescendantId } from './chat-tree'

const tree = [
  { id: 'answer-1', parentResponseId: null },
  { id: 'answer-2', parentResponseId: null },
  { id: 'follow-up', parentResponseId: 'answer-2' },
  { id: 'alternate-follow-up', parentResponseId: 'answer-2' },
]

describe('local chat trees', () => {
  it('renders only the selected root-to-leaf lineage', () => {
    expect(lineageFromLeaf(tree, 'follow-up').map((node) => node.id)).toEqual(['answer-2', 'follow-up'])
    expect(lineageFromLeaf(tree, 'answer-1').map((node) => node.id)).toEqual(['answer-1'])
  })

  it('continues through the newest descendant when activating an ancestor', () => {
    expect(newestDescendantId(tree, 'answer-2')).toBe('alternate-follow-up')
  })
})
