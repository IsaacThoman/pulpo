import { describe, expect, it } from 'vitest'
import { UNKNOWN_MODEL_ID } from './defaults.js'
import { removeDeletedModelPreferences } from './model-deletion.js'

describe('deleted model replacement', () => {
  it('uses an immutable placeholder identity', () => {
    expect(UNKNOWN_MODEL_ID).toBe('pulpo-unknown-model')
  })

  it('removes functional references without changing unrelated preferences', () => {
    expect(removeDeletedModelPreferences({
      theme: 'dark',
      defaultModelId: 'deleted-model',
      favoriteModelIds: ['other-model', 'deleted-model'],
      providerOrder: ['deleted-model', 'other-model'],
      generation: {
        'deleted-model': { effort: 'high' },
        'other-model': { effort: 'low' },
      },
    }, 'deleted-model')).toEqual({
      changed: true,
      value: {
        theme: 'dark',
        defaultModelId: null,
        favoriteModelIds: ['other-model'],
        providerOrder: ['other-model'],
        generation: { 'other-model': { effort: 'low' } },
      },
    })
  })

  it('does not rewrite preferences that do not reference the model', () => {
    const value = { theme: 'light', favoriteModelIds: ['other-model'] }
    expect(removeDeletedModelPreferences(value, 'deleted-model')).toEqual({ changed: false, value })
  })

  it('cleans the same references from nested new-account defaults', () => {
    expect(removeDeletedModelPreferences({
      defaultModelId: 'deleted-model',
      favoriteModelIds: ['first-model', 'deleted-model', 'last-model'],
    }, 'deleted-model')).toEqual({
      changed: true,
      value: {
        defaultModelId: null,
        favoriteModelIds: ['first-model', 'last-model'],
      },
    })
  })
})
