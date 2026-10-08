import { describe, expect, it } from 'vitest'
import { parseAuthSettings } from './application-settings.js'
import { firstUnavailableModelReference, newAccountModelReferenceIds, withNewAccountModelDefaults } from './new-account-defaults.js'
import { preferencesWithModelDefaults } from './model-preferences.js'

describe('new-account model defaults', () => {
  it('stores new accounts as following the model defaults', () => {
    expect(preferencesWithModelDefaults()).toMatchObject({ defaultModelId: null, favoriteModelIds: null })
    expect(preferencesWithModelDefaults({ defaultModelId: '', favoriteModelIds: 'invalid' }))
      .toMatchObject({ defaultModelId: null, favoriteModelIds: null })
  })

  it('fills unset model choices from the current new-account defaults', () => {
    const settings = parseAuthSettings({
      newAccountModelDefaults: {
        defaultModelId: 'model-a',
        favoriteModelIds: ['model-c', 'model-a', 'model-b'],
      },
    })
    expect(withNewAccountModelDefaults(preferencesWithModelDefaults({ providerOrder: ['lab-a'] }), settings)).toEqual({
      values: expect.objectContaining({
        defaultModelId: 'model-a',
        favoriteModelIds: ['model-c', 'model-a', 'model-b'],
        providerOrder: ['lab-a'],
      }),
      followedModelDefaults: { defaultModelId: true, favoriteModelIds: true },
    })
  })

  it('keeps customized model choices, including ones equal to the defaults', () => {
    const settings = parseAuthSettings({
      newAccountModelDefaults: { defaultModelId: 'model-a', favoriteModelIds: ['model-a'] },
    })
    expect(withNewAccountModelDefaults(
      preferencesWithModelDefaults({ defaultModelId: 'model-b', favoriteModelIds: ['model-a'] }),
      settings,
    )).toEqual({
      values: expect.objectContaining({ defaultModelId: 'model-b', favoriteModelIds: ['model-a'] }),
      followedModelDefaults: { defaultModelId: false, favoriteModelIds: false },
    })
    expect(withNewAccountModelDefaults(preferencesWithModelDefaults({ favoriteModelIds: [] }), settings).values)
      .toMatchObject({ defaultModelId: 'model-a', favoriteModelIds: [] })
  })

  it('returns unique model references for availability validation', () => {
    const settings = parseAuthSettings({
      newAccountModelDefaults: {
        defaultModelId: 'model-a',
        favoriteModelIds: ['model-b', 'model-a'],
      },
    })
    expect(newAccountModelReferenceIds(settings)).toEqual(['model-a', 'model-b'])
    expect(firstUnavailableModelReference(
      newAccountModelReferenceIds(settings),
      ['model-b'],
    )).toBe('model-a')
    expect(firstUnavailableModelReference(
      newAccountModelReferenceIds(settings),
      ['model-a', 'model-b'],
    )).toBeNull()
  })
})
