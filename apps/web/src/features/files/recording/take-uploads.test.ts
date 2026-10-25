// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { discardTake, queueTake, retryTake, useTakeUploads } from './take-uploads'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
const upload = vi.hoisted(() => vi.fn())
vi.mock('./api', async (actual) => ({ ...await actual<object>(), uploadRecordingClip: upload }))

const metadata = (durationMs: number) => ({ durationMs, levels: [] })
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  useTakeUploads.setState({ takes: [] })
  upload.mockReset()
})

describe('take uploads', () => {
  it('saves a recording’s takes one at a time, in the order they were recorded', async () => {
    const order: number[] = []
    let release: () => void = () => undefined
    upload.mockImplementationOnce(async (_id: string, _audio: Blob, meta: { durationMs: number }) => {
      await new Promise<void>((resolve) => { release = resolve })
      order.push(meta.durationMs)
      return { id: 'first' }
    }).mockImplementation(async (_id: string, _audio: Blob, meta: { durationMs: number }) => {
      order.push(meta.durationMs)
      return { id: `take-${meta.durationMs}` }
    })
    queueTake('rec', new Blob(['a']), metadata(1))
    queueTake('rec', new Blob(['b']), metadata(2))
    await settled()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(useTakeUploads.getState().takes.map((take) => take.status)).toEqual(['uploading', 'waiting'])
    release()
    await vi.waitFor(() => expect(useTakeUploads.getState().takes).toEqual([]))
    expect(order).toEqual([1, 2])
  })

  it('holds the takes after one that failed until it is retried or discarded', async () => {
    upload.mockRejectedValueOnce(new ApiError(503, 'recording_audio_busy', 'Busy')).mockResolvedValue({ id: 'saved' })
    queueTake('rec', new Blob(['a']), metadata(1))
    queueTake('rec', new Blob(['b']), metadata(2))
    await vi.waitFor(() => expect(useTakeUploads.getState().takes[0]?.status).toBe('failed'))
    expect(useTakeUploads.getState().takes[0]?.error).toBe('Saving takes is busy right now. Try again shortly.')
    expect(useTakeUploads.getState().takes[1]?.status).toBe('waiting')
    expect(upload).toHaveBeenCalledTimes(1)

    retryTake(useTakeUploads.getState().takes[0]!.key)
    await vi.waitFor(() => expect(useTakeUploads.getState().takes).toEqual([]))
    expect(upload.mock.calls.map((call) => call[2].durationMs)).toEqual([1, 1, 2])
  })

  it('moves on to the next take when a failed one is discarded', async () => {
    upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'saved' })
    queueTake('rec', new Blob(['a']), metadata(1))
    queueTake('rec', new Blob(['b']), metadata(2))
    await vi.waitFor(() => expect(useTakeUploads.getState().takes[0]?.status).toBe('failed'))
    discardTake(useTakeUploads.getState().takes[0]!.key)
    await vi.waitFor(() => expect(useTakeUploads.getState().takes).toEqual([]))
    expect(upload.mock.calls.map((call) => call[2].durationMs)).toEqual([1, 2])
  })
})
