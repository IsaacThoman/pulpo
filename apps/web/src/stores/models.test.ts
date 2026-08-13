import { describe, expect, it } from 'vitest'
import { resetFavoriteIds } from './models'

describe('model favorites', () => {
  it('resets favorites to the configured new-account order', () => {
    const defaults = ['default-b', 'default-a']
    const favorites = resetFavoriteIds(defaults)

    expect(favorites).toEqual(['default-b', 'default-a'])
    expect(favorites).not.toBe(defaults)
  })
})
