import { describe, expect, it } from 'vitest'
import { normalizedPreferencePatch, preferencesWithModelDefaults } from './model-preferences.js'

describe('account model preferences', () => {
  it('adds clean defaults to older preference records', () => {
    expect(preferencesWithModelDefaults({ theme: 'dark' })).toEqual({
      theme: 'dark', newChatAutoExpire: true, favoriteModelIds: [], providerOrder: [],
    })
  })

  it('preserves valid new-chat expiration defaults and repairs invalid legacy values', () => {
    expect(preferencesWithModelDefaults({ newChatAutoExpire: false }).newChatAutoExpire).toBe(false)
    expect(preferencesWithModelDefaults({ newChatAutoExpire: 'false' }).newChatAutoExpire).toBe(true)
  })

  it('normalizes only supplied model preference fields in a patch', () => {
    expect(normalizedPreferencePatch({
      theme: 'light', favoriteModelIds: ['model-b', 'model-a', 'model-b'],
    })).toEqual({ theme: 'light', favoriteModelIds: ['model-b', 'model-a'] })
  })

  it('rejects malformed model preference arrays', () => {
    expect(() => normalizedPreferencePatch({ providerOrder: 'lab-one' })).toThrow()
    expect(() => preferencesWithModelDefaults({ favoriteModelIds: [''] })).toThrow()
  })
})
