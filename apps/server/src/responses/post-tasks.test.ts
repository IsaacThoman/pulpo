import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModelRuntime } from './catalog-model-runtime.js'

const persistGeneratedChatTitle = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../chats/title-change.js', () => ({ persistGeneratedChatTitle }))

import { persistGeneratedTitleResult, selectPostTaskRuntime } from './post-tasks.js'

function runtime(id: string): CatalogModelRuntime {
  return { model: { id }, provider: {} } as CatalogModelRuntime
}

afterEach(() => {
  persistGeneratedChatTitle.mockClear()
})

describe('post-response task model selection', () => {
  it('uses a fixed available task model', () => {
    const current = runtime('current-model')
    const selected = runtime('small-task-model')
    expect(selectPostTaskRuntime(current, selected)).toBe(selected)
  })

  it('falls back to the completed response model when the selection is unavailable', () => {
    const current = runtime('completed-fallback-model')
    expect(selectPostTaskRuntime(current, null)).toBe(current)
  })

  it('persists a parsed generated title through the realtime-aware helper', async () => {
    await expect(persistGeneratedTitleResult({
      userId: 'user-1',
      chatId: 'chat-1',
      outputText: '{"title":"  Generated title  "}',
    })).resolves.toBe(true)

    expect(persistGeneratedChatTitle).toHaveBeenCalledWith({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Generated title',
    })
  })

  it('does not persist or publish malformed title output', async () => {
    await expect(persistGeneratedTitleResult({
      userId: 'user-1',
      chatId: 'chat-1',
      outputText: 'A plain title',
    })).resolves.toBe(false)

    expect(persistGeneratedChatTitle).not.toHaveBeenCalled()
  })
})
