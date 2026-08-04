import { describe, expect, it } from 'vitest'
import { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

describe('production preference mapping', () => {
  it('hydrates the mobile names used by the web settings bridge', () => {
    expect(preferencesFromServer({
      theme: 'dark', localAttachmentCacheMb: 96, localChatLimit: 200,
      trashRetention: '7d', agentModeEnabled: false, ignored: 'value',
    })).toEqual({
      theme: 'dark', attachmentCacheMb: 96, localChatLimit: 50,
      trashRetention: '7d', agentMode: false,
    })
  })

  it('maps mobile-only names back to the server and ignores device-only settings', () => {
    expect(preferencePatchForServer('attachmentCacheMb', 64)).toEqual({ localAttachmentCacheMb: 64 })
    expect(preferencePatchForServer('trashRetention', '90d')).toEqual({ trashRetention: '90d' })
    expect(preferencePatchForServer('haptics', false)).toBeNull()
  })
})
