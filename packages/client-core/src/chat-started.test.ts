import { describe, expect, it, vi } from 'vitest'
import { createChatStartedChannel } from './chat-started.js'

const event = (chatId: string) => ({ chatId, responseId: `response:${chatId}` })

describe('live chat start delivery', () => {
  it('claims a navigation before duplicate or competing events can arrive', () => {
    const channel = createChatStartedChannel()
    const open = vi.fn(() => channel.receive('account', event('competing')))
    channel.follow('account', () => true, open)
    channel.receive('account', event('first'))
    channel.receive('account', event('first'))
    channel.receive('account', event('third'))
    expect(open.mock.calls).toEqual([[event('first')]])
  })

  it('does not replay events received before mounting, while ineligible, or after unmounting', () => {
    const channel = createChatStartedChannel(), open = vi.fn()
    channel.receive('account', event('before'))
    let eligible = false
    const unsubscribe = channel.follow('account', () => eligible, open)
    channel.receive('account', event('blurred'))
    eligible = true
    channel.receive('account', event('before'))
    channel.receive('account', event('blurred'))
    expect(open).not.toHaveBeenCalled()
    unsubscribe()
    channel.receive('account', event('after'))
    channel.follow('account', () => true, open)
    channel.receive('account', event('after'))
    channel.receive('account', event('fresh'))
    expect(open.mock.calls).toEqual([[event('fresh')]])
  })

  it('isolates accounts and instances, and ignores local sends including outbox retries', () => {
    const channel = createChatStartedChannel(), open = vi.fn()
    channel.follow('instance-a|account', () => true, open)
    channel.ignoreLocal('instance-a|account', 'local')
    channel.receive('instance-a|account', event('local'))
    channel.receive('instance-a|other', event('foreign'))
    channel.receive('instance-b|account', event('foreign'))
    expect(open).not.toHaveBeenCalled()
    channel.receive('instance-a|account', event('foreign'))
    expect(open.mock.calls).toEqual([[event('foreign')]])
  })
})
