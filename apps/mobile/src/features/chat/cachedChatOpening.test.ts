import { afterEach, expect, it, vi } from 'vitest'
import { chooseCachedChatOpening } from './cachedChatOpening'
afterEach(() => vi.useRealTimers())

it('uses a quick cached result before any animation deadline', async () => {
  vi.useFakeTimers()
  const cached = vi.fn(); const fallback = vi.fn()
  chooseCachedChatOpening(Promise.resolve(true), cached, fallback)
  await vi.advanceTimersByTimeAsync(0)
  expect(cached).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(100)
  expect(fallback).not.toHaveBeenCalled()
})
it('starts fallback immediately for a missing or failed cache read', async () => {
  const cached = vi.fn(); const fallback = vi.fn()
  chooseCachedChatOpening(Promise.resolve(false), cached, fallback)
  await Promise.resolve()
  expect(fallback).toHaveBeenCalledOnce()
  expect(cached).not.toHaveBeenCalled()
})
it('bounds the lookup wait and ignores a late cached result during the slide', async () => {
  vi.useFakeTimers()
  let resolve!: (ready: boolean) => void
  const local = new Promise<boolean>((r) => { resolve = r })
  const cached = vi.fn(); const fallback = vi.fn()
  chooseCachedChatOpening(local, cached, fallback)
  await vi.advanceTimersByTimeAsync(50)
  expect(fallback).toHaveBeenCalledOnce()
  resolve(true)
  await Promise.resolve()
  expect(cached).not.toHaveBeenCalled()
})
it('cancels both lookup completion and the fallback timer on navigation changes', async () => {
  vi.useFakeTimers()
  const cached = vi.fn(); const fallback = vi.fn()
  const cancel = chooseCachedChatOpening(Promise.resolve(true), cached, fallback)
  cancel()
  await vi.advanceTimersByTimeAsync(100)
  expect(cached).not.toHaveBeenCalled()
  expect(fallback).not.toHaveBeenCalled()
})
