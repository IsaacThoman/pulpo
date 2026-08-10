import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NewAccountModelDefaultsFields,
} from './new-account-model-defaults'
import {
  addFavoriteModel,
  defaultModelOptions,
  moveFavoriteModel,
  removeFavoriteModel,
  withDefaultModel,
} from './new-account-model-defaults-logic'

const models = [
  { id: 'model-a', name: 'Model A', tags: [] },
  { id: 'model-b', name: 'Model B', tags: [] },
]

describe('new-account model default fields', () => {
  it('reorders favorite IDs without mutating the original value', () => {
    const original = ['model-a', 'model-b', 'model-c']
    expect(moveFavoriteModel(original, 2, -1)).toEqual(['model-a', 'model-c', 'model-b'])
    expect(moveFavoriteModel(original, 0, -1)).toBe(original)
    expect(original).toEqual(['model-a', 'model-b', 'model-c'])
  })

  it('adds and removes favorites without duplicates', () => {
    const original = ['model-a']
    expect(addFavoriteModel(original, 'model-b')).toEqual(['model-a', 'model-b'])
    expect(addFavoriteModel(original, 'model-a')).toBe(original)
    expect(removeFavoriteModel(['model-a', 'model-b'], 'model-a')).toEqual(['model-b'])
  })

  it('keeps favorites independent when the default changes or becomes Automatic', () => {
    const original = { defaultModelId: null, favoriteModelIds: ['model-b', 'model-a'] }
    expect(withDefaultModel(original, 'model-c')).toEqual({
      defaultModelId: 'model-c',
      favoriteModelIds: ['model-b', 'model-a'],
    })
    expect(withDefaultModel(withDefaultModel(original, 'model-c'), null)).toEqual(original)
  })

  it('offers Automatic and preserves an unavailable selected default', () => {
    expect(defaultModelOptions(models, 'retired-model')).toEqual([
      { value: '__automatic__', label: 'Automatic (first available)' },
      { value: 'model-a', label: 'Model A (model-a)' },
      { value: 'model-b', label: 'Model B (model-b)' },
      { value: 'retired-model', label: 'Unavailable (retired-model)' },
    ])
  })

  it('renders favorites in saved order and labels unavailable IDs', () => {
    const markup = renderToStaticMarkup(
      <NewAccountModelDefaultsFields
        models={models}
        value={{ defaultModelId: null, favoriteModelIds: ['model-b', 'retired-model', 'model-a'] }}
        onChange={() => undefined}
      />
    )
    expect(markup).toContain('New account models')
    expect(markup.indexOf('Model B (model-b)')).toBeLessThan(markup.indexOf('Unavailable (retired-model)'))
    expect(markup.indexOf('Unavailable (retired-model)')).toBeLessThan(markup.indexOf('Model A (model-a)'))
    expect(markup).toContain('Automatic uses the first available model')
  })
})
