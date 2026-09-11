import { expect, it, vi } from 'vitest'
import { createUploadQueue } from '@pulpo/client-core'
import { ThumbnailCache } from './thumbnail-cache.js'

it('serves 500 previews with two decoders, shares requests, and caches the results', async () => {
  const cache = new ThumbnailCache()
  const client = createUploadQueue(4)
  let active = 0, peak = 0
  const render = vi.fn(async () => {
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active -= 1
    return Buffer.alloc(100)
  })
  await Promise.all(Array.from({ length: 500 }, (_, index) => client(async () => {
    const one = cache.get(`image-${index}`, render)
    const two = cache.get(`image-${index}`, render)
    expect(one).toBe(two)
    await one
  })))
  expect(peak).toBe(2)
  expect(render).toHaveBeenCalledTimes(500)
  await Promise.all(Array.from({ length: 500 }, (_, index) => cache.get(`image-${index}`, render)))
  expect(render).toHaveBeenCalledTimes(500)
})

it('evicts by byte budget and retries failed renders', async () => {
  const cache = new ThumbnailCache(10)
  const render = vi.fn(async () => Buffer.alloc(6))
  await cache.get('one', render)
  await cache.get('two', render)
  await cache.get('one', render)
  expect(render).toHaveBeenCalledTimes(3)
  await expect(cache.get('bad', async () => { throw new Error('decode') })).rejects.toThrow('decode')
  await expect(cache.get('bad', render)).resolves.toHaveLength(6)
})
