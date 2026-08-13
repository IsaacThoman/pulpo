import { describe, expect, it } from 'vitest'
import { favoriteIdsMatch, resetFavoriteIds } from './models'

describe('model favorites', () => {
  it('resets favorites to the configured new-account order', () => {
    const defaults = ['default-b', 'default-a']
    const favorites = resetFavoriteIds(defaults)

    expect(favorites).toEqual(['default-b', 'default-a'])
    expect(favorites).not.toBe(defaults)
  })

  it('matches favorites only when IDs and order equal the new-account defaults', () => {
    expect(favoriteIdsMatch([], [])).toBe(true)
    expect(favoriteIdsMatch(['model-b', 'model-a'], ['model-b', 'model-a'])).toBe(true)
    expect(favoriteIdsMatch(['model-a', 'model-b'], ['model-b', 'model-a'])).toBe(false)
    expect(favoriteIdsMatch(['model-b'], ['model-b', 'model-a'])).toBe(false)
  })
})
