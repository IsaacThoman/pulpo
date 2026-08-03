import { describe, expect, it } from 'vitest'
import { reorderList, resolveOrder } from './model-order'

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
})
