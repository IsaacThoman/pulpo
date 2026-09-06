import { afterEach, expect, it, vi } from 'vitest'
import { createPersistenceQueue } from './persistence-queue'

afterEach(() => vi.useRealTimers())

it('coalesces before writing and flushes the latest terminal value immediately', async () => {
  vi.useFakeTimers()
  const write = vi.fn(async (_value: number) => {})
  const queue = createPersistenceQueue(write, vi.fn())
  for (let i = 0; i < 20; i++) queue.schedule(i)
  await vi.advanceTimersByTimeAsync(999)
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(write.mock.calls).toEqual([[19]])
  queue.schedule(20)
  await queue.flush()
  expect(write.mock.calls).toEqual([[19], [20]])
})

it('serializes writes and drops stale queued data before account removal', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const write = vi.fn((_value: number) => new Promise<void>((resolve) => { finish = resolve }))
  const queue = createPersistenceQueue(write, vi.fn())
  queue.schedule(1)
  const flushing = queue.flush()
  await Promise.resolve()
  queue.schedule(2)
  queue.schedule(3)
  expect(write.mock.calls).toEqual([[1]])
  let removed = false
  const removal = queue.cancel().then(() => { removed = true })
  expect(removed).toBe(false)
  finish()
  await Promise.all([flushing, removal])
  await vi.runAllTimersAsync()
  expect(removed).toBe(true)
  expect(write.mock.calls).toEqual([[1]])
})

it('writes the latest queued state after an in-flight transaction', async () => {
  let finish!: () => void
  const write = vi.fn(async (_value: number) => {})
  write.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const queue = createPersistenceQueue(write, vi.fn())
  queue.schedule(1)
  const pending = queue.flush()
  await Promise.resolve()
  queue.schedule(2)
  queue.schedule(3)
  finish()
  await pending
  expect(write.mock.calls).toEqual([[1], [3]])
})

it('accepts future saves after a storage failure', async () => {
  vi.useFakeTimers()
  const error = new Error('quota')
  const write = vi.fn(async (_value: number) => {}).mockRejectedValueOnce(error)
  const onError = vi.fn()
  const queue = createPersistenceQueue(write, onError)
  queue.schedule(1)
  await vi.runAllTimersAsync()
  expect(onError).toHaveBeenCalledWith(error)
  queue.schedule(2)
  await queue.flush()
  expect(write.mock.calls).toEqual([[1], [2]])
})

it('saves newer pending state when the in-flight transaction fails', async () => {
  vi.useFakeTimers()
  let fail!: (error: Error) => void
  const write = vi.fn(async (_value: number) => {})
    .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  const queue = createPersistenceQueue(write, vi.fn())
  queue.schedule(1)
  const flushing = queue.flush()
  await Promise.resolve()
  queue.schedule(2)
  fail(new Error('temporary storage failure'))
  await expect(flushing).rejects.toThrow('temporary storage failure')
  await vi.runAllTimersAsync()
  expect(write.mock.calls).toEqual([[1], [2]])
})
