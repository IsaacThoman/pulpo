import { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ServerChat } from '../types'
const mocks = vi.hoisted(() => ({ cached: vi.fn(), network: vi.fn(), write: vi.fn(), outbox: vi.fn() }))
vi.mock('../api/client', () => ({ mobileApi: { chat: mocks.network } }))
vi.mock('./database', () => ({ cachedChat: mocks.cached, pendingOutbox: mocks.outbox, cacheOpenedChat: mocks.write, markCachedChatOpened: mocks.write }))
import { chatQuery, queryKeys } from './queries'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { resolve, promise } }
const fixture = { id: 'a', title: 'local', responses: [], attachments: [], temporary: false } as unknown as ServerChat
beforeEach(() => { vi.clearAllMocks(); mocks.write.mockResolvedValue(undefined); mocks.outbox.mockResolvedValue([]) })
it('publishes local detail before the network completes, then reconciles the network result', async () => {
  const network = deferred<ServerChat>()
  mocks.cached.mockResolvedValue(fixture)
  mocks.network.mockReturnValue(network.promise)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const pending = client.fetchQuery(chatQuery('n', 'a'))
  await vi.waitFor(() => expect(client.getQueryData(queryKeys.chat('n', 'a'))).toEqual(fixture))
  network.resolve({ ...fixture, title: 'server' })
  await pending
  expect(client.getQueryData(queryKeys.chat('n', 'a'))).toMatchObject({ title: 'server' })
  client.clear()
})
it('does not let a late local read roll back an optimistic update', async () => {
  const disk = deferred<ServerChat>()
  const network = deferred<ServerChat>()
  mocks.cached.mockReturnValue(disk.promise)
  mocks.network.mockReturnValue(network.promise)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const pending = client.fetchQuery(chatQuery('n', 'a'))
  client.setQueryData(queryKeys.chat('n', 'a'), { ...fixture, title: 'optimistic' })
  disk.resolve(fixture)
  await Promise.resolve(); await Promise.resolve()
  expect(client.getQueryData(queryKeys.chat('n', 'a'))).toMatchObject({ title: 'optimistic' })
  network.resolve(fixture); await pending; client.clear()
})
it('cancellation prevents late disk hydration from resurrecting a removed account query', async () => {
  const disk = deferred<ServerChat>()
  mocks.cached.mockReturnValue(disk.promise)
  mocks.network.mockReturnValue(new Promise(() => {}))
  const client = new QueryClient()
  const pending = client.fetchQuery(chatQuery('old', 'a')).catch(() => undefined)
  await client.cancelQueries({ queryKey: queryKeys.chat('old', 'a') })
  client.removeQueries({ queryKey: queryKeys.chat('old', 'a') })
  disk.resolve(fixture)
  await pending; await Promise.resolve()
  expect(client.getQueryData(queryKeys.chat('old', 'a'))).toBeUndefined()
  client.clear()
})
it('does not persist a cancelled account request after outbox reconciliation finishes', async () => {
  const outbox = deferred<[]>()
  mocks.cached.mockResolvedValue(fixture)
  mocks.network.mockResolvedValue(fixture)
  mocks.outbox.mockReturnValue(outbox.promise)
  const client = new QueryClient()
  const pending = client.fetchQuery(chatQuery('old', 'a')).catch(() => undefined)
  await vi.waitFor(() => expect(mocks.outbox).toHaveBeenCalled())
  await client.cancelQueries({ queryKey: queryKeys.chat('old', 'a') })
  outbox.resolve([])
  await pending; await Promise.resolve(); await Promise.resolve()
  expect(mocks.write).not.toHaveBeenCalled()
  client.clear()
})
