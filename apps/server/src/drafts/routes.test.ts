import { describe, expect, it, vi } from 'vitest'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
import { draftSyncEnabled, parseComposerDraftScope } from './routes.js'

describe('composer draft route policy', () => {
  it('supports one new-chat scope and UUID thread scopes', () => {
    expect(parseComposerDraftScope('new')).toEqual({ scope: 'new', chatId: null })
    const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'
    expect(parseComposerDraftScope(chatId)).toEqual({ scope: chatId, chatId })
    expect(() => parseComposerDraftScope('someone-elses-chat')).toThrow('valid draft scope')
  })

  it('defaults draft sync on and honors an explicit opt-out', () => {
    expect(draftSyncEnabled(undefined)).toBe(true)
    expect(draftSyncEnabled({})).toBe(true)
    expect(draftSyncEnabled({ syncDrafts: true })).toBe(true)
    expect(draftSyncEnabled({ syncDrafts: false })).toBe(false)
  })
})
