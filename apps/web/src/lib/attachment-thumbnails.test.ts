import { beforeEach, expect, it, vi } from 'vitest'

const fetchBlob = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ fetchApiBlob: fetchBlob }))
beforeEach(() => { vi.resetModules(); fetchBlob.mockReset() })

it('limits 500 preview requests to two and reuses cached results per account', async () => {
  const { loadAttachmentThumbnail } = await import('./attachment-thumbnails')
  let active = 0, peak = 0
  fetchBlob.mockImplementation(async () => {
    peak = Math.max(peak, ++active)
    await Promise.resolve()
    active--
    return new Blob(['thumbnail'])
  })
  const signal = new AbortController().signal
  await Promise.all(Array.from({ length: 500 }, (_, id) => loadAttachmentThumbnail('account', String(id), signal)))
  expect(peak).toBe(2)
  await loadAttachmentThumbnail('account', '0', signal)
  expect(fetchBlob).toHaveBeenCalledTimes(500)
  await loadAttachmentThumbnail('different-account', '0', signal)
  expect(fetchBlob).toHaveBeenCalledTimes(501)
})

it('shares a load across Strict Mode remounts without letting the first cancellation cancel the second', async () => {
  const { loadAttachmentThumbnail } = await import('./attachment-thumbnails')
  fetchBlob.mockResolvedValue(new Blob(['preview']))
  const first = new AbortController()
  const one = loadAttachmentThumbnail('account', 'photo', first.signal)
  first.abort()
  const two = loadAttachmentThumbnail('account', 'photo', new AbortController().signal)
  expect(one).toBe(two)
  await expect(two).resolves.toBeInstanceOf(Blob)
  expect(fetchBlob).toHaveBeenCalledOnce()
})

it('skips queued previews that scroll out of view before starting', async () => {
  const { loadAttachmentThumbnail } = await import('./attachment-thumbnails')
  const controller = new AbortController()
  controller.abort()
  await expect(loadAttachmentThumbnail('account', 'offscreen', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetchBlob).not.toHaveBeenCalled()
})
