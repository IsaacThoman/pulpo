import { expect, it, vi } from 'vitest'
import { createUploadQueue, retryBusyUpload } from './upload-queue.js'

it('backs off on capacity errors without retrying permanent upload failures', async () => {
  vi.useFakeTimers()
  try {
    const operation = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue('uploaded')
    const result = retryBusyUpload(operation)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(operation).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('uploaded')
    const invalid = vi.fn().mockRejectedValue({ status: 413 })
    await expect(retryBusyUpload(invalid)).rejects.toEqual({ status: 413 })
    expect(invalid).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('uploads hundreds of files in order with bounded concurrency and releases failed slots', async () => {
  const enqueue = createUploadQueue(3)
  let active = 0
  let peak = 0
  const started: number[] = []
  const jobs = Array.from({ length: 500 }, (_, index) => enqueue(async () => {
    started.push(index)
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 0))
    active -= 1
    if (index === 7) throw new Error('Transfer failed')
    return index
  }))
  const results = await Promise.allSettled(jobs)
  expect(peak).toBe(3)
  expect(active).toBe(0)
  expect(started).toEqual(Array.from({ length: 500 }, (_, index) => index))
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(499)
  expect(results[7]?.status).toBe('rejected')
})
