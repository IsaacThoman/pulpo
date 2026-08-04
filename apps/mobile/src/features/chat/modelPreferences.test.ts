import { describe, expect, it } from 'vitest'
import { orderedModelsById, resolveVisibleOrder } from './modelPreferences'

describe('mobile model preference ordering', () => {
  it('filters unavailable ids and appends newly available providers', () => {
    expect(resolveVisibleOrder(['missing', 'lab-b', 'lab-a'], ['lab-a', 'lab-b', 'lab-c']))
      .toEqual(['lab-b', 'lab-a', 'lab-c'])
  })

  it('renders favorites in exact saved order while retaining unavailable ids in storage', () => {
    const models = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(orderedModelsById(models, ['missing', 'c', 'a'])).toEqual([{ id: 'c' }, { id: 'a' }])
  })
})
