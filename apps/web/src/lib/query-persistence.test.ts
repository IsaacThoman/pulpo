import { describe, expect, it } from 'vitest'
import { shouldPersistQuery } from './query-persistence'

describe('query persistence policy', () => {
  it('never persists scoped administrator chat data', () => {
    expect(shouldPersistQuery({
      queryKey: ['chat', 'admin-chat:access-1', 'chat-1'],
      state: { status: 'success', data: { id: 'chat-1' } },
    })).toBe(false)
    expect(shouldPersistQuery({
      queryKey: ['chats', 'admin-chat:access-1'],
      state: { status: 'success', data: [] },
    })).toBe(false)
  })

  it('retains the existing owner query behavior', () => {
    expect(shouldPersistQuery({ queryKey: ['chat', 'owner-1'], state: { status: 'success', data: { temporary: false } } })).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['chat', 'owner-1'], state: { status: 'success', data: { temporary: true } } })).toBe(false)
  })
})
