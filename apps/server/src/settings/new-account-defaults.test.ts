import { describe, expect, it } from 'vitest'
import { parseAuthSettings } from './application-settings.js'
import { firstUnavailableModelReference, newAccountModelReferenceIds, newAccountPreferenceValues } from './new-account-defaults.js'

describe('new-account model defaults', () => {
  it('builds an empty account preference snapshot for legacy settings', () => {
    const settings = parseAuthSettings({ signupEnabled: false })
    expect(newAccountPreferenceValues(settings)).toEqual({
      defaultModelId: null,
      animationSpeed: 1,
      agentModes: {},
      instructionPresetSelections: {},
      automaticChatExpiration: '24h',
      newChatAutoExpire: false,
      syncDrafts: true,
      favoriteModelIds: [],
      providerOrder: [],
      sidebarPins: { usage: false, billing: false, friends: false, apiKeys: false },
    })
  })

  it('copies the configured default and ordered favorites into a snapshot', () => {
    const settings = parseAuthSettings({
      newAccountModelDefaults: {
        defaultModelId: 'model-a',
        favoriteModelIds: ['model-c', 'model-a', 'model-b'],
      },
    })
    expect(newAccountPreferenceValues(settings)).toEqual({
      defaultModelId: 'model-a',
      animationSpeed: 1,
      agentModes: {},
      instructionPresetSelections: {},
      automaticChatExpiration: '24h',
      newChatAutoExpire: false,
      syncDrafts: true,
      favoriteModelIds: ['model-c', 'model-a', 'model-b'],
      providerOrder: [],
      sidebarPins: { usage: false, billing: false, friends: false, apiKeys: false },
    })
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
