// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useChatHistory } from './use-chat-history'

const fixture = vi.hoisted(() => ({
  userId: 'user', warm: false, cached: undefined as any,
  request: vi.fn(), setDetailedChat: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ apiRequest: fixture.request }))
vi.mock('@/lib/query-client', () => ({ queryClient: {
  getQueryData: () => fixture.cached,
  setQueryData: (_key: unknown, value: unknown) => { fixture.cached = value },
} }))
vi.mock('@/stores/auth', () => ({ useAuth: Object.assign(
  (selector: (state: unknown) => unknown) => selector({ user: { id: fixture.userId } }),
  { getState: () => ({ user: { id: fixture.userId } }) },
) }))
vi.mock('@/stores/chat', async () => {
  const { mergeHistory } = await import('@/lib/chat-history')
  return {
    useChat: Object.assign(
      (selector: (state: unknown) => unknown) => selector({ chats: [{ id: 'chat', history: { hasMore: fixture.warm } }] }),
      { getState: () => ({ setDetailedChat: fixture.setDetailedChat }) },
    ),
    mergeServerChatDetails: (cached: any, incoming: any) => ({ ...incoming, ...mergeHistory(cached.responses, incoming.responses, incoming.history) }),
  }
})
const rows = Array.from({ length: 1200 }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null }))
const page = () => ({ id: 'chat', activeBranchLeafId: '1199', responses: rows.slice(200, 700),
  history: { offset: 200, hasMore: true, before: '200', leafId: '1199' } })
beforeEach(() => {
  fixture.userId = 'user'
  fixture.warm = false
  fixture.cached = { id: 'chat', activeBranchLeafId: '1199', responses: rows.slice(700),
    history: { offset: 700, hasMore: true, before: '700', leafId: '1199' } }
  fixture.request.mockReset()
  fixture.setDetailedChat.mockReset()
})
afterEach(cleanup)

it('deduplicates concurrent requests and prepends to the latest cached tail', async () => {
  let resolve!: (value: unknown) => void
  fixture.request.mockImplementation(() => new Promise(r => { resolve = r }))
  const view = renderHook(() => useChatHistory('chat'))
  await act(async () => {
    const first = view.result.current.load()
    const second = view.result.current.load()
    expect(fixture.request).toHaveBeenCalledTimes(1)
    fixture.cached.responses[0] = { ...fixture.cached.responses[0], content: 'newer streamed content' }
    resolve(page())
    await Promise.all([first, second])
  })
  expect(fixture.cached.responses).toHaveLength(1000)
  expect(fixture.cached.responses[500].content).toBe('newer streamed content')
  expect(fixture.cached.history.offset).toBe(200)
  expect(fixture.setDetailedChat).toHaveBeenCalledTimes(1)
})

it.each(['branch', 'account', 'server-branch'])('discards a late page after the %s changes', async reason => {
  let resolve!: (value: unknown) => void
  fixture.request.mockImplementation(() => new Promise(r => { resolve = r }))
  const view = renderHook(() => useChatHistory('chat'))
  await act(async () => {
    const pending = view.result.current.load()
    if (reason === 'branch') fixture.cached = { ...fixture.cached, activeBranchLeafId: 'new-leaf' }
    if (reason === 'account') fixture.userId = 'other-user'
    const latest = fixture.cached
    resolve(reason === 'server-branch' ? { ...page(), history: { ...page().history, leafId: 'other-leaf' } } : page())
    await pending
    expect(fixture.cached).toBe(latest)
  })
  expect(fixture.setDetailedChat).not.toHaveBeenCalled()
})

it('can retry a failed page without losing the existing history', async () => {
  fixture.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page())
  const initial = fixture.cached
  const view = renderHook(() => useChatHistory('chat'))
  await act(() => view.result.current.load())
  expect(view.result.current.error).toBe(true)
  expect(view.result.current.loading).toBe(false)
  expect(fixture.cached).toBe(initial)
  await act(() => view.result.current.load())
  expect(view.result.current.error).toBe(false)
  expect(fixture.cached.responses).toHaveLength(1000)
})

it('warms one additional page before the user scrolls', async () => {
  fixture.warm = true
  fixture.request.mockResolvedValue(page())
  renderHook(() => useChatHistory('chat'))
  await waitFor(() => expect(fixture.setDetailedChat).toHaveBeenCalledTimes(1))
  expect(fixture.request).toHaveBeenCalledTimes(1)
  expect(fixture.request).toHaveBeenCalledWith('/api/chats/chat?format=compact&scope=active&historyLimit=500&before=700')
})
