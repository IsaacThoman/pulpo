import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminChatIdFromInput, adminShareTokenFromInput } from '@/features/admin-chat/identifier'

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'

afterEach(() => vi.unstubAllGlobals())

describe('admin chat launcher input', () => {
  it('accepts UUIDs and Pulpo chat URLs', () => {
    vi.stubGlobal('location', { origin: 'https://pulpo.example' })

    expect(adminChatIdFromInput(chatId)).toBe(chatId)
    expect(adminChatIdFromInput(`https://pulpo.example/c/${chatId}`)).toBe(chatId)
    expect(adminChatIdFromInput(`/admin/chats/${chatId}`)).toBe(chatId)
    expect(adminChatIdFromInput(`  /c/${chatId}/?source=test#latest  `)).toBe(chatId)
  })

  it('rejects unrelated and malformed URLs', () => {
    vi.stubGlobal('location', { origin: 'https://pulpo.example' })

    expect(adminChatIdFromInput('not-a-uuid')).toBeNull()
    expect(adminChatIdFromInput(`https://pulpo.example/settings/${chatId}`)).toBeNull()
    expect(adminChatIdFromInput(`${chatId}/extra`)).toBeNull()
  })

  it.each([
    'https://pulpo.example/share/abc_DEF-123',
    '/share/abc_DEF-123',
    '  /share/abc_DEF-123/?source=test#latest  ',
    'https://another.pulpo.example/share/abc_DEF-123?source=test#latest',
    '/share/%61bc_DEF-123',
  ])('extracts the token from %s', (input) => {
    vi.stubGlobal('location', { origin: 'https://pulpo.example' })
    expect(adminShareTokenFromInput(input)).toBe('abc_DEF-123')
    expect(adminChatIdFromInput(input)).toBeNull()
  })

  it.each([
    '', 'abc_DEF-123', '/share/', '/share/token/extra', '/settings/token',
    '/share/%', '/share/%2F', '/share/token%20space', 'ftp://pulpo.example/share/token',
  ])('rejects invalid share input %s', (input) => {
    vi.stubGlobal('location', { origin: 'https://pulpo.example' })
    expect(adminShareTokenFromInput(input)).toBeNull()
  })
})
