import { describe, expect, it } from 'vitest'
import { resetFavoriteIds, useModels } from './models'

describe('model favorites', () => {
  it('resets favorites to the configured new-account order', () => {
    const defaults = ['default-b', 'default-a']
    const favorites = resetFavoriteIds(defaults)

    expect(favorites).toEqual(['default-b', 'default-a'])
    expect(favorites).not.toBe(defaults)
  })

  it('follows the new-account defaults after a reset until favorites change again', () => {
    useModels.setState({ favoriteModelIds: ['custom'], favoritesFollowDefaults: false, newAccountFavoriteModelIds: ['default-a'] })
    useModels.getState().resetFavorites()
    expect(useModels.getState()).toMatchObject({ favoriteModelIds: ['default-a'], favoritesFollowDefaults: true })

    useModels.getState().toggleFavorite('custom')
    expect(useModels.getState()).toMatchObject({ favoriteModelIds: ['default-a', 'custom'], favoritesFollowDefaults: false })
  })
})
