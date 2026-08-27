import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminChatIdFromInput } from '@/features/admin-chat/identifier'

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'

afterEach(() => vi.unstubAllGlobals())

describe('admin chat launcher input', () => {
  it('accepts UUIDs and Pulpo chat URLs', () => {
    vi.stubGlobal('location', { origin: 'https://pulpo.example' })

    expect(adminChatIdFromInput(chatId)).toBe(chatId)
    expect(adminChatIdFromInput(`https://pulpo.example/c/${chatId}`)).toBe(chatId)
    expect(adminChatIdFromInput(`/admin/chats/${chatId}`)).toBe(chatId)
  })

  it('rejects unrelated and malformed URLs', () => {
    vi.stubGlobal('location', { origin: 'https://pulpo.example' })

    expect(adminChatIdFromInput('not-a-uuid')).toBeNull()
    expect(adminChatIdFromInput(`https://pulpo.example/settings/${chatId}`)).toBeNull()
    expect(adminChatIdFromInput(`${chatId}/extra`)).toBeNull()
  })
})
