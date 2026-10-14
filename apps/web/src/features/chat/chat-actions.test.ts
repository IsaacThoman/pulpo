// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})
const store = vi.hoisted(() => ({
  duplicateChat: vi.fn(async (id: string) => `${id}-copy`),
  deleteChat: vi.fn(async () => undefined),
  shareChat: vi.fn(async () => 'https://pulpo.example/share/token'),
}))
const apiRequest = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/stores/chat', () => ({ useChat: { getState: () => store } }))
vi.mock('@/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiRequest }))

const { copyChatShareLink, duplicateChats } = await import('./chat-actions')
const { useFileToasts } = await import('@/features/files/browser/toasts')
const { ApiError } = await import('@/lib/api')

const toasts = () => useFileToasts.getState().toasts

beforeEach(() => {
  vi.clearAllMocks()
  useFileToasts.setState({ toasts: [] })
})

describe('chat actions', () => {
  it('duplicates chats, and deletes the copies for good on undo', async () => {
    expect(await duplicateChats([{ id: 'a', title: 'Trip' }])).toEqual(['a-copy'])
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Duplicated "Trip"', undo: expect.any(Function) })])
    await toasts()[0]!.undo!()
    expect(store.deleteChat).toHaveBeenCalledWith('a-copy')
    expect(apiRequest).toHaveBeenCalledWith('/api/chats/a-copy/permanent', { method: 'DELETE' })
  })

  it('reports a failed duplicate', async () => {
    store.duplicateChat.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Chat not found'))
    expect(await duplicateChats([{ id: 'a', title: 'Trip' }])).toEqual([])
    expect(toasts()).toEqual([expect.objectContaining({ tone: 'error' })])
  })

  it('copies a share link and says so', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyChatShareLink('a')
    expect(writeText).toHaveBeenCalledWith('https://pulpo.example/share/token')
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Copied share link' })])
    vi.unstubAllGlobals()
  })
})
