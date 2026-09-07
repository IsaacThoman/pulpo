import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ServerChat } from '../types'
const mocks = vi.hoisted(() => ({ disk: vi.fn(), network: vi.fn(), write: vi.fn(), outbox: vi.fn() }))
vi.mock('../api/client', () => ({ mobileApi: { chat: mocks.network } }))
vi.mock('./database', () => ({ cachedChat: mocks.disk, pendingOutbox: mocks.outbox, cacheOpenedChat: mocks.write, markCachedChatOpened: mocks.write }))
import { prepareChatSelection } from './prepareChat'
import { chatQuery, queryKeys } from './queries'

const local = { id: 'a', title: 'cached', responses: [], attachments: [], queuedMessages: [], temporary: false } as unknown as ServerChat
const server = { ...local, title: 'server' }
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.disk.mockImplementation(async (_n, _id, ready) => { await ready?.(); return local })
  mocks.network.mockImplementation(async (_id, _signal, ready) => { await ready?.(); return server })
  mocks.write.mockResolvedValue(undefined)
  mocks.outbox.mockResolvedValue([])
})

it('starts disk and network I/O immediately but publishes and persists only after the slide', async () => {
  const c = client()
  const selection = prepareChatSelection(c, 'n', 'a', 50)
  expect(mocks.disk).toHaveBeenCalledOnce()
  expect(mocks.network).toHaveBeenCalledOnce()
  await Promise.resolve(); await Promise.resolve()
  expect(c.getQueryData(queryKeys.chat('n', 'a'))).toBeUndefined()
  expect(mocks.outbox).not.toHaveBeenCalled()
  expect(mocks.write).not.toHaveBeenCalled()
  selection.finish()
  await vi.waitFor(() => expect(c.getQueryData(queryKeys.chat('n', 'a'))).toEqual(server))
  c.clear()
})

it('reuses resident data without reading SQLite or replacing it during the slide', async () => {
  const c = client()
  c.setQueryData(queryKeys.chat('n', 'a'), local)
  const selection = prepareChatSelection(c, 'n', 'a', 50)
  expect(mocks.disk).not.toHaveBeenCalled()
  expect(mocks.network).toHaveBeenCalledOnce()
  expect(c.getQueryData(queryKeys.chat('n', 'a'))).toBe(local)
  selection.finish()
  await vi.waitFor(() => expect(c.getQueryData(queryKeys.chat('n', 'a'))).toEqual(server))
  c.clear()
})

it('cancels abandoned work without late data or writes and permits a subsequent selection', async () => {
  const c = client()
  const abandoned = prepareChatSelection(c, 'old', 'a', 50)
  abandoned.cancel()
  abandoned.finish()
  c.removeQueries({ queryKey: queryKeys.chat('old', 'a') })
  const selected = prepareChatSelection(c, 'new', 'a', 50)
  selected.finish()
  await vi.waitFor(() => expect(c.getQueryData(queryKeys.chat('new', 'a'))).toEqual(server))
  expect(c.getQueryData(queryKeys.chat('old', 'a'))).toBeUndefined()
  expect(mocks.write.mock.calls.every(([namespace]) => namespace === 'new')).toBe(true)
  c.clear()
})

it('allows a new detail observer to adopt preparation when its navigation is interrupted', async () => {
  const c = client()
  const selection = prepareChatSelection(c, 'n', 'a', 50)
  const observer = new QueryObserver(c, chatQuery('n', 'a'))
  const unsubscribe = observer.subscribe(() => {})
  selection.cancel()
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(server))
  unsubscribe(); c.clear()
})

it('preserves optimistic data written after preparation started when cancelling', async () => {
  const c = client()
  c.setQueryData(queryKeys.chat('n', 'a'), local)
  const selection = prepareChatSelection(c, 'n', 'a', 50)
  const optimistic = { ...local, title: 'unsaved edit' }
  c.setQueryData(queryKeys.chat('n', 'a'), optimistic)
  selection.cancel()
  await vi.waitFor(() => expect(c.isFetching()).toBe(0))
  expect(c.getQueryData(queryKeys.chat('n', 'a'))).toEqual(optimistic)
  c.clear()
})

it('does not cancel a replacement fetch on the same query instance', async () => {
  const c = client()
  const selection = prepareChatSelection(c, 'n', 'a', 50)
  await c.cancelQueries({ queryKey: queryKeys.chat('n', 'a') }, { revert: false })
  let resolve!: (value: ServerChat) => void
  mocks.network.mockReturnValue(new Promise<ServerChat>((r) => { resolve = r }))
  const replacement = c.fetchQuery(chatQuery('n', 'a'))
  selection.cancel()
  expect(mocks.network.mock.calls.at(-1)![1].aborted).toBe(false)
  resolve(server)
  await expect(replacement).resolves.toEqual(server)
  c.clear()
})

it('does not gate or cancel a request that was already fetching', async () => {
  let resolve!: (value: ServerChat) => void
  mocks.network.mockReturnValue(new Promise<ServerChat>((r) => { resolve = r }))
  const c = client()
  const pending = c.fetchQuery(chatQuery('n', 'a'))
  const selection = prepareChatSelection(c, 'n', 'a', 50)
  selection.cancel()
  expect(mocks.network).toHaveBeenCalledOnce()
  expect(mocks.network.mock.calls[0]![1].aborted).toBe(false)
  resolve(server)
  await expect(pending).resolves.toEqual(server)
  c.clear()
})
