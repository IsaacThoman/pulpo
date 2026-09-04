import { describe, expect, it } from 'vitest'
import { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

describe('production preference mapping', () => {
  it('shares composer sync as an account preference with enabled defaults', () => {
    expect(preferencesFromServer({ composerSyncEnabled: false }).composerSyncEnabled).toBe(false)
    expect(preferencesFromServer({}).composerSyncEnabled).toBe(true)
    expect(preferencePatchForServer('composerSyncEnabled', false)).toEqual({ composerSyncEnabled: false })
  })
  it('hydrates the mobile names used by the web settings bridge', () => {
    expect(preferencesFromServer({
      theme: 'dark', localAttachmentCacheMb: 96, localChatLimit: 200,
      trashRetention: '7d', automaticChatExpiration: '24h', newChatAutoExpire: false, memoryEnabled: true, agentModeEnabled: false, ignored: 'value',
      favoriteModelIds: ['model-b', 'model-a', 'model-b'], providerOrder: ['lab-b', 'lab-a'],
      generation: { 'model-a': { reasoning: 'high', style: 'concise' } },
      agentModes: { 'model-a': false, 'model-b': true },
    })).toEqual({
      composerSyncEnabled: true,
      theme: 'dark', attachmentCacheMb: 96, localChatLimit: 50,
      trashRetention: '7d', automaticChatExpiration: '24h', newChatAutoExpire: false, memoryEnabled: true,
      favoriteModelIds: ['model-b', 'model-a'], providerOrder: ['lab-b', 'lab-a'],
      generation: { 'model-a': { reasoning: 'high', style: 'concise' } },
      agentModes: { 'model-a': false, 'model-b': true },
    })
  })

  it('maps mobile-only names back to the server and ignores device-only settings', () => {
    expect(preferencePatchForServer('attachmentCacheMb', 64)).toEqual({ localAttachmentCacheMb: 64 })
    expect(preferencePatchForServer('trashRetention', '90d')).toEqual({ trashRetention: '90d' })
    expect(preferencePatchForServer('automaticChatExpiration', '7d')).toEqual({ automaticChatExpiration: '7d' })
    expect(preferencePatchForServer('newChatAutoExpire', false)).toEqual({ newChatAutoExpire: false })
    expect(preferencePatchForServer('memoryEnabled', true)).toEqual({ memoryEnabled: true })
    expect(preferencePatchForServer('favoriteModelIds', ['model-b', 'model-a'])).toEqual({ favoriteModelIds: ['model-b', 'model-a'] })
    expect(preferencePatchForServer('providerOrder', ['lab-b', 'lab-a'])).toEqual({ providerOrder: ['lab-b', 'lab-a'] })
    expect(preferencePatchForServer('generation', { 'model-a': { reasoning: 'high' } })).toEqual({
      generation: { 'model-a': { reasoning: 'high' } },
    })
    expect(preferencePatchForServer('agentModes', { 'model-a': false })).toEqual({ agentModes: { 'model-a': false } })
    expect(preferencePatchForServer('haptics', false)).toBeNull()
    expect(preferencesFromServer({ agentModeEnabled: false }).agentModes).toEqual({})
  })

  it('clears synchronized model preferences when older servers omit them', () => {
    expect(preferencesFromServer({})).toEqual({ composerSyncEnabled: true, favoriteModelIds: [], providerOrder: [], generation: {}, agentModes: {} })
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

  it('filters malformed Agent mode preferences from server settings', () => {
    expect(preferencesFromServer({
      agentModes: { valid: false, enabled: true, ignored: 'false' },
    }).agentModes).toEqual({ valid: false, enabled: true })
    expect(preferencesFromServer({ agentModes: ['invalid'] }).agentModes).toEqual({})
  })
})
