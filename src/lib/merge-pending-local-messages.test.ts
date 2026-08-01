import { describe, expect, it } from 'vitest'
import type { Message } from './types'
import { mergePendingLocalMessages } from './merge-pending-local-messages'

function message(id: string, role: Message['role'], done = true): Message {
  return { id, role, content: id, timestamp: 0, done }
}

describe('mergePendingLocalMessages', () => {
  it('preserves the optimistic turn when an empty detail lands during streaming', () => {
    const local = [message('pending:input', 'user'), message('pending', 'assistant', false)]

    expect(mergePendingLocalMessages([], local, ['pending'])).toEqual(local)
  })

  it('accepts an authoritative empty detail when no turn is streaming', () => {
    const deleted = [message('deleted:input', 'user'), message('deleted', 'assistant')]

    expect(mergePendingLocalMessages([], deleted, [])).toEqual([])
  })

  it('does not resurrect a completed turn from a stale streaming id', () => {
    const deleted = [message('deleted:input', 'user'), message('deleted', 'assistant')]

    expect(mergePendingLocalMessages([], deleted, ['deleted'])).toEqual([])
  })

  it('appends an in-flight turn to a stale non-empty server prefix', () => {
    const server = [message('saved:input', 'user'), message('saved', 'assistant')]
    const pending = [message('pending:input', 'user'), message('pending', 'assistant', false)]

    expect(mergePendingLocalMessages(server, [...server, ...pending], ['pending'])).toEqual([...server, ...pending])
  })

  it('preserves multiple concurrent optimistic turns on empty detail', () => {
    const local = [
      message('a:input', 'user'), message('a', 'assistant', false),
      message('b:input', 'user'), message('b', 'assistant', false),
    ]

    expect(mergePendingLocalMessages([], local, ['a', 'b'])).toEqual(local)
  })
})
