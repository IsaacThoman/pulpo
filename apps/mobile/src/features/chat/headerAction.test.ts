import { describe, expect, it } from 'vitest'
import { resolveChatHeaderAction } from './headerAction'

describe('resolveChatHeaderAction', () => {
  it('shows the temporary toggle on an empty new chat', () => {
    expect(resolveChatHeaderAction(null, 0)).toBe('temporary-toggle')
  })

  it('shows new chat once an optimistic message exists', () => {
    expect(resolveChatHeaderAction(null, 1)).toBe('new-chat')
  })

  it('shows new chat while an existing conversation is loading', () => {
    expect(resolveChatHeaderAction('chat-1', 0)).toBe('new-chat')
  })
})
