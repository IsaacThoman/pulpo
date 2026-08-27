import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { adminAccessRequiredChatId } from './route-access'

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'

describe('admin chat route access', () => {
  it('requires the access gate only when the server identifies a foreign chat', () => {
    expect(adminAccessRequiredChatId(
      chatId,
      new ApiError(403, 'chat_not_in_account', 'This chat belongs to another account'),
    )).toBe(chatId)
  })

  it('defaults missing and failed chats to the normal new-chat view', () => {
    expect(adminAccessRequiredChatId(chatId, undefined)).toBeNull()
    expect(adminAccessRequiredChatId(chatId, new ApiError(404, 'not_found', 'Chat not found'))).toBeNull()
    expect(adminAccessRequiredChatId(chatId, new ApiError(500, 'request_failed', 'Request failed'))).toBeNull()
    expect(adminAccessRequiredChatId(chatId, new TypeError('Failed to fetch'))).toBeNull()
  })
})
