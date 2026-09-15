import type { FastifyRequest } from 'fastify'
import { expect, it, vi } from 'vitest'
const remove = vi.hoisted(() => vi.fn())
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ delete: remove }) }))
import { cleanupSpeechPreview } from './preview.js'
it('retains cleanup of legacy preview blobs and tolerates storage failures', async () => {
  const warn = vi.fn()
  const request = { log: { warn } } as unknown as FastifyRequest
  remove.mockResolvedValueOnce(undefined)
  await cleanupSpeechPreview('legacy.wav', request)
  expect(remove).toHaveBeenCalledWith('legacy.wav')
  remove.mockRejectedValueOnce(new Error('Storage offline'))
  await cleanupSpeechPreview('other.wav', request)
  expect(warn).toHaveBeenCalledWith('Speech preview cleanup failed')
})
