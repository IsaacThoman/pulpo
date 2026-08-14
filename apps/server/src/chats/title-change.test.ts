import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  publishStateChange: vi.fn(async () => undefined),
}))

vi.mock('../database/client.js', () => ({
  db: { transaction: mocks.transaction },
}))
vi.mock('../responses/events.js', () => ({
  publishStateChange: mocks.publishStateChange,
}))

import { persistGeneratedChatTitle } from './title-change.js'

function mockTransaction(input: {
  updated?: { chatId: string; userId: string }
  revision?: number
  order?: string[]
}) {
  const chatReturning = vi.fn(async () => {
    input.order?.push('title')
    return input.updated ? [input.updated] : []
  })
  const userReturning = vi.fn(async () => {
    input.order?.push('revision')
    return input.revision === undefined ? [] : [{ revision: input.revision }]
  })
  const chatWhere = vi.fn(() => ({ returning: chatReturning }))
  const userWhere = vi.fn(() => ({ returning: userReturning }))
  const chatSet = vi.fn(() => ({ where: chatWhere }))
  const userSet = vi.fn(() => ({ where: userWhere }))
  const update = vi.fn()
    .mockReturnValueOnce({ set: chatSet })
    .mockReturnValueOnce({ set: userSet })

  mocks.transaction.mockImplementationOnce(async (task: (tx: { update: typeof update }) => Promise<unknown>) => {
    const result = await task({ update })
    input.order?.push('commit')
    return result
  })

  return { update, chatSet, userSet }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('generated chat title persistence', () => {
  it('commits the title and account revision before publishing the chat change', async () => {
    const order: string[] = []
    const transaction = mockTransaction({
      updated: { chatId: 'chat-1', userId: 'user-1' },
      revision: 42,
      order,
    })
    mocks.publishStateChange.mockImplementationOnce(async () => { order.push('publish') })

    await expect(persistGeneratedChatTitle({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Generated title',
    })).resolves.toBe(true)

    expect(transaction.update).toHaveBeenCalledTimes(2)
    expect(transaction.chatSet).toHaveBeenCalledWith({
      title: 'Generated title',
      updatedAt: expect.any(Date),
    })
    expect(transaction.userSet).toHaveBeenCalledWith({ stateRevision: expect.anything() })
    expect(mocks.publishStateChange).toHaveBeenCalledWith({
      userId: 'user-1',
      chatId: 'chat-1',
      revision: 42,
    })
    expect(order).toEqual(['title', 'revision', 'commit', 'publish'])
  })

  it('does not bump or publish when the title is unchanged', async () => {
    const transaction = mockTransaction({})

    await expect(persistGeneratedChatTitle({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Existing title',
    })).resolves.toBe(false)

    expect(transaction.update).toHaveBeenCalledTimes(1)
    expect(transaction.userSet).not.toHaveBeenCalled()
    expect(mocks.publishStateChange).not.toHaveBeenCalled()
  })

  it('fails the transaction instead of committing a title without a revision', async () => {
    mockTransaction({ updated: { chatId: 'chat-1', userId: 'user-1' } })

    await expect(persistGeneratedChatTitle({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Generated title',
    })).rejects.toThrow('Chat owner disappeared')
    expect(mocks.publishStateChange).not.toHaveBeenCalled()
  })
})
