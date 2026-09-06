import { afterEach, expect, it, vi } from 'vitest'
import { createSyncScheduler } from './sync-scheduler'
import { outboxInvalidationQueryKeys } from './response-sync'

afterEach(() => vi.useRealTimers())

it('coalesces wakeups and serializes one follow-up during an in-flight sync', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const sync = vi.fn(async () => {})
  sync.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const scheduler = createSyncScheduler(sync, vi.fn())
  scheduler.request(); scheduler.request(); scheduler.request()
  await vi.advanceTimersByTimeAsync(100)
  expect(sync).toHaveBeenCalledTimes(1)
  scheduler.request(); scheduler.request()
  await vi.advanceTimersByTimeAsync(500)
  expect(sync).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(100)
  expect(sync).toHaveBeenCalledTimes(2)
  scheduler.dispose()
})

it('recovers after failed synchronization and cancels queued work on teardown', async () => {
  vi.useFakeTimers()
  const sync = vi.fn(async () => {}).mockRejectedValueOnce(new Error('timeout'))
  const onError = vi.fn()
  const scheduler = createSyncScheduler(sync, onError)
  scheduler.request()
  await vi.advanceTimersByTimeAsync(100)
  expect(onError).toHaveBeenCalledTimes(1)
  scheduler.request()
  await vi.advanceTimersByTimeAsync(100)
  expect(sync).toHaveBeenCalledTimes(2)
  scheduler.request()
  scheduler.dispose()
  await vi.advanceTimersByTimeAsync(100)
  expect(sync).toHaveBeenCalledTimes(2)
})

it('invalidates only state affected by settled outbox operations', () => {
  expect(outboxInvalidationQueryKeys([], 'u', 'active')).toEqual([])
  expect(outboxInvalidationQueryKeys(['/api/settings'], 'u', 'active')).toEqual([['settings', 'u']])
  expect(outboxInvalidationQueryKeys(['/api/chats/active', '/api/chats/order'], 'u', 'active')).toEqual([
    ['chats', 'u'], ['deleted-chats', 'u'], ['chat', 'u', 'active'],
  ])
  expect(outboxInvalidationQueryKeys(['/api/folders/folder-a'], 'u', 'active')).toEqual([
    ['folders', 'u'], ['chats', 'u'], ['deleted-chats', 'u'], ['chat', 'u', 'active'],
  ])
})
