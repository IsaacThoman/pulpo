import { describe, expect, it } from 'vitest'
import { nextChatStartsTemporary, resolveChatHeaderAction, resolveChatHeaderControl } from './headerAction'

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

  it('expands into save and new-chat actions after the first temporary message', () => {
    expect(resolveChatHeaderAction('temporary-1', 2, true)).toBe('temporary-actions')
  })

  it('keeps the next chat temporary when started from a temporary conversation', () => {
    expect(nextChatStartsTemporary(true)).toBe(true)
    expect(nextChatStartsTemporary(false)).toBe(false)
  })

  it('expands expiration from the ghost on a blank normal chat', () => {
    expect(resolveChatHeaderControl('temporary-toggle', true)).toEqual({
      expanded: true,
      leadingAction: 'expiration',
      trailingAction: 'ghost',
    })
  })

  it('uses the same leading slot for expiration and temporary-chat saving', () => {
    expect(resolveChatHeaderControl('new-chat', true)).toEqual({
      expanded: true,
      leadingAction: 'expiration',
      trailingAction: 'new-chat',
    })
    expect(resolveChatHeaderControl('temporary-actions', false)).toEqual({
      expanded: true,
      leadingAction: 'save',
      trailingAction: 'new-chat',
    })
  })

  it('collapses to the ghost while temporary mode is empty', () => {
    expect(resolveChatHeaderControl('temporary-toggle', false)).toEqual({
      expanded: false,
      leadingAction: 'none',
      trailingAction: 'ghost',
    })
  })
})
