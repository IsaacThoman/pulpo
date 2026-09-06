// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { Chat, Message } from '@/lib/types'

// Measure row rendering independently of Markdown parsing, which has its own suite.
vi.mock('./Markdown', () => ({ Markdown: ({ content }: { content: string }) => <p>{content}</p> }))
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
const [{ useChat }, catalog, { MessageList }, { selectAvailableChatIds }] = await Promise.all([
  import('@/stores/chat'), import('@/stores/catalog'), import('./MessageList'), import('@/lib/chat-availability'),
])
await import('@/i18n')
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each([200, 1000])('keeps completed rows stable with %i messages during foreground/background updates', async (count) => {
  const messages: Message[] = Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`, role: 'assistant', modelId: `model-${index}`,
    content: `Response ${index}`, done: true, timestamp: 1,
  }))
  const chat: Chat = { id: 'active', title: 'Chat', modelId: 'model', messages, createdAt: 1, updatedAt: 1, pinned: false, folderId: null, sortOrder: 0, temporary: false, expiresAt: null, expired: false, tags: [] }
  useChat.setState({ chats: [chat, { ...chat, id: 'background', messages: [] }] })
  const getModel = vi.spyOn(catalog, 'getCatalogModel')
  const view = render(<MessageList chat={chat} activeModelId="model" />)
  getModel.mockClear()
  await act(async () => useChat.setState((state) => ({ chats: state.chats.map((item) => item.id === 'background' ? { ...item, title: 'Changed' } : item) })))
  expect(getModel).not.toHaveBeenCalled()
  await act(async () => useChat.setState((state) => ({ chats: state.chats.map((item) => item.id !== chat.id ? item : {
    ...item, messages: item.messages.map((message, index) => index === count - 1 ? { ...message, content: 'Updated response' } : message),
  }) })))
  expect(getModel.mock.calls).toEqual([[`model-${count - 1}`]])
  expect(view.getByText('Updated response')).toBeTruthy()
}, 20_000)

it('preserves a shared availability index until sources become unavailable', () => {
  const chats = [{ id: 'source', expired: false }] as Chat[]
  const initial = selectAvailableChatIds({ chats })
  expect(initial?.has('source')).toBe(true)
  expect(selectAvailableChatIds({ chats: [{ ...chats[0]!, title: 'Renamed' }] })).toBe(initial)
  expect(selectAvailableChatIds({ chats: [{ ...chats[0]!, expired: true }] })?.has('source')).toBe(false)
  expect(selectAvailableChatIds({ chats: [] })).toBeNull()
})
