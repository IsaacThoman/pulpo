import { describe, expect, it } from 'vitest'
import { appendMissingOrder, reorderList, resolveOrder } from './model-order'

describe('model picker ordering', () => {
  it('reorders the visible labs when no order has been persisted yet', () => {
    const visible = ['Moonshot', 'OpenAI', 'Anthropic']
    const initial = resolveOrder([], visible)

    expect(reorderList(initial, 'Anthropic', 'Moonshot', 'before')).toEqual([
      'Anthropic',
      'Moonshot',
      'OpenAI',
    ])
  })

  it('retains new labs alongside the persisted order', () => {
    expect(resolveOrder(['OpenAI', 'Moonshot'], ['Moonshot', 'Anthropic', 'OpenAI']))
      .toEqual(['OpenAI', 'Moonshot', 'Anthropic'])
  })

  it('keeps unavailable stable ids in storage while reordering visible providers', () => {
    const stored = appendMissingOrder(['retired-lab', 'lab-b'], ['lab-a', 'lab-b', 'lab-c'])
    expect(stored).toEqual(['retired-lab', 'lab-b', 'lab-a', 'lab-c'])
    expect(reorderList(stored, 'lab-c', 'lab-b', 'before')).toEqual([
      'retired-lab', 'lab-c', 'lab-b', 'lab-a',
    ])
  })
})
