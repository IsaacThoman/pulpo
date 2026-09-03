import { afterEach, describe, expect, it } from 'vitest'
import {
  adminChatAccessHeaders,
  adminChatAccountKey,
  clearAdminChatGrant,
  getAdminChatGrant,
  setAdminChatGrant,
} from './access'

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'

function grant() {
  return {
    accessToken: 'secret-access-token-that-must-stay-in-memory',
    accessId: 'access-1',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    chatId,
    owner: {
      id: 'owner-1',
      email: 'owner@example.com',
      name: 'Owner',
      username: 'owner',
      role: 'user' as const,
      blocked: false,
    },
  }
}

afterEach(() => clearAdminChatGrant())

describe('admin chat access state', () => {
  it('keeps the grant in memory and isolates query state under the access id', () => {
    setAdminChatGrant(grant())

    expect(getAdminChatGrant()?.accessToken).toContain('secret-access-token')
    expect(adminChatAccountKey()).toBe('admin-chat:access-1')
  })

  it('adds the token only to the scoped chat API surface', () => {
    setAdminChatGrant(grant())
    const header = { 'x-pulpo-admin-chat-access': grant().accessToken }

    expect(adminChatAccessHeaders(`/api/chats/${chatId}`)).toEqual(header)
    expect(adminChatAccessHeaders('/api/messages/response-1/regenerate')).toEqual(header)
    expect(adminChatAccessHeaders('/api/attachments/attachment-1')).toEqual(header)
    expect(adminChatAccessHeaders(`/api/chat-shares?chatId=${chatId}`)).toEqual(header)
    expect(adminChatAccessHeaders('/api/folders')).toEqual(header)

    expect(adminChatAccessHeaders('/api/chats')).toEqual({})
    expect(adminChatAccessHeaders('/api/profile')).toEqual({})
    expect(adminChatAccessHeaders('/api/settings')).toEqual({})
    expect(adminChatAccessHeaders('/api/admin/users')).toEqual({})
  })
})
