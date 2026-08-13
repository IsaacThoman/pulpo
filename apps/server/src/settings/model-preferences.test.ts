import { describe, expect, it } from 'vitest'
import { normalizedPreferencePatch, preferencesWithModelDefaults } from './model-preferences.js'

describe('account model preferences', () => {
  it('adds clean defaults to older preference records', () => {
    expect(preferencesWithModelDefaults({ theme: 'dark' })).toEqual({
      theme: 'dark', automaticChatExpiration: '24h', newChatAutoExpire: false,
      sidebarPins: { usage: false, friends: false, apiKeys: false }, favoriteModelIds: [], providerOrder: [],
    })
  })

  it('preserves valid new-chat expiration defaults and repairs invalid legacy values', () => {
    expect(preferencesWithModelDefaults({ automaticChatExpiration: '7d' }).automaticChatExpiration).toBe('7d')
    expect(preferencesWithModelDefaults({ automaticChatExpiration: '30d' }).automaticChatExpiration).toBe('24h')
    expect(preferencesWithModelDefaults({ newChatAutoExpire: true }).newChatAutoExpire).toBe(true)
    expect(preferencesWithModelDefaults({ newChatAutoExpire: false }).newChatAutoExpire).toBe(false)
    expect(preferencesWithModelDefaults({ newChatAutoExpire: 'false' }).newChatAutoExpire).toBe(false)
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

  it('normalizes sidebar pins and defaults missing links to unpinned', () => {
    expect(preferencesWithModelDefaults({ sidebarPins: { usage: true } }).sidebarPins).toEqual({
      usage: true, friends: false, apiKeys: false,
    })
    expect(normalizedPreferencePatch({ sidebarPins: { friends: false } }).sidebarPins).toEqual({
      usage: false, friends: false, apiKeys: false,
    })
    expect(() => normalizedPreferencePatch({ sidebarPins: { usage: 'yes' } })).toThrow()
  })
})
