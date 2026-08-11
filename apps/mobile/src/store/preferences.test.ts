import { describe, expect, it } from 'vitest'
import { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

describe('production preference mapping', () => {
  it('hydrates the mobile names used by the web settings bridge', () => {
    expect(preferencesFromServer({
      theme: 'dark', localAttachmentCacheMb: 96, localChatLimit: 200,
      trashRetention: '7d', automaticChatExpiration: '24h', newChatAutoExpire: false, agentModeEnabled: false, ignored: 'value',
      favoriteModelIds: ['model-b', 'model-a', 'model-b'], providerOrder: ['lab-b', 'lab-a'],
      generation: { 'model-a': { reasoning: 'high', style: 'concise' } },
    })).toEqual({
      theme: 'dark', attachmentCacheMb: 96, localChatLimit: 50,
      trashRetention: '7d', automaticChatExpiration: '24h', newChatAutoExpire: false,
      favoriteModelIds: ['model-b', 'model-a'], providerOrder: ['lab-b', 'lab-a'],
      generation: { 'model-a': { reasoning: 'high', style: 'concise' } },
    })
  })

  it('maps mobile-only names back to the server and ignores device-only settings', () => {
    expect(preferencePatchForServer('attachmentCacheMb', 64)).toEqual({ localAttachmentCacheMb: 64 })
    expect(preferencePatchForServer('trashRetention', '90d')).toEqual({ trashRetention: '90d' })
    expect(preferencePatchForServer('automaticChatExpiration', '7d')).toEqual({ automaticChatExpiration: '7d' })
    expect(preferencePatchForServer('newChatAutoExpire', false)).toEqual({ newChatAutoExpire: false })
    expect(preferencePatchForServer('favoriteModelIds', ['model-b', 'model-a'])).toEqual({ favoriteModelIds: ['model-b', 'model-a'] })
    expect(preferencePatchForServer('providerOrder', ['lab-b', 'lab-a'])).toEqual({ providerOrder: ['lab-b', 'lab-a'] })
    expect(preferencePatchForServer('generation', { 'model-a': { reasoning: 'high' } })).toEqual({
      generation: { 'model-a': { reasoning: 'high' } },
    })
    expect(preferencePatchForServer('haptics', false)).toBeNull()
    expect(preferencePatchForServer('agentMode', true)).toBeNull()
    expect(preferencesFromServer({ agentModeEnabled: true })).not.toHaveProperty('agentMode')
  })

  it('clears synchronized model preferences when older servers omit them', () => {
    expect(preferencesFromServer({})).toEqual({ favoriteModelIds: [], providerOrder: [], generation: {} })
  })

  it('filters malformed generation preferences from server settings', () => {
    expect(preferencesFromServer({
      generation: {
        valid: { reasoning: 'medium', ignored: 42 },
        missing: null,
        list: ['high'],
      },
    }).generation).toEqual({ valid: { reasoning: 'medium' } })
    expect(preferencesFromServer({ generation: 'invalid' }).generation).toEqual({})
  })
})
