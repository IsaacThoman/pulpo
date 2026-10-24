import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadOptions } from 'expo-file-system'

vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  },
}))

import { UPLOAD_STALL_TIMEOUT_MS, uploadFileWithStallTimeout } from './nativeUpload'

function pendingUpload() {
  let options: UploadOptions | undefined
  let resolve: (value: { status: number; body: string; headers: Record<string, string> }) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const upload = vi.fn((_url: string, given?: UploadOptions) => {
    options = given
    return new Promise<{ status: number; body: string; headers: Record<string, string> }>((res, rej) => { resolve = res; reject = rej })
  })
  return { file: { upload }, upload, options: () => options!, resolve: (status: number) => resolve({ status, body: '', headers: {} }), reject: (error: Error) => reject(error) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('stall-guarded native uploads', () => {
  it('uploads on a foreground session with the given request options', async () => {
    const task = pendingUpload()
    const result = uploadFileWithStallTimeout(task.file, 'https://example.com/upload', {
      httpMethod: 'PUT', mimeType: 'image/jpeg', headers: { 'content-type': 'application/octet-stream' },
    })
    expect(task.upload).toHaveBeenCalledWith('https://example.com/upload', expect.objectContaining({
      httpMethod: 'PUT', mimeType: 'image/jpeg', headers: { 'content-type': 'application/octet-stream' }, sessionType: 'foreground',
    }))
    task.resolve(204)
    await expect(result).resolves.toMatchObject({ status: 204 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails as a timeout and cancels the native task when nothing moves', async () => {
    const task = pendingUpload()
    const result = uploadFileWithStallTimeout(task.file, 'https://example.com/upload', { httpMethod: 'PUT' })
    const settled = vi.fn()
    result.catch(settled)

    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    expect(task.options().signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).rejects.toMatchObject({ status: 408, code: 'request_timeout' })
    expect(task.options().signal?.aborted).toBe(true)
  })

  it('settles even when the native task never reacts to cancellation', async () => {
    const task = pendingUpload()
    const result = uploadFileWithStallTimeout(task.file, 'https://example.com/upload', { httpMethod: 'PUT' }, 1_000)
    const assertion = expect(result).rejects.toMatchObject({ code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    // A late native rejection after the stall is ignored.
    task.reject(new Error('cancelled'))
  })

  it('keeps a slow upload alive while progress is reported', async () => {
    const task = pendingUpload()
    const result = uploadFileWithStallTimeout(task.file, 'https://example.com/upload', { httpMethod: 'PUT' }, 1_000)
    const settled = vi.fn()
    result.then(settled, settled)

    for (let step = 0; step < 5; step += 1) {
      await vi.advanceTimersByTimeAsync(900)
      task.options().onProgress?.({ bytesSent: (step + 1) * 100, totalBytes: 1_000 })
    }
    expect(settled).not.toHaveBeenCalled()
    expect(task.options().signal?.aborted).toBe(false)

    task.resolve(204)
    await expect(result).resolves.toMatchObject({ status: 204 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes native failures through unchanged and clears the stall timer', async () => {
    const task = pendingUpload()
    const result = uploadFileWithStallTimeout(task.file, 'https://example.com/upload', { httpMethod: 'PUT' })
    task.reject(new Error('Connection lost'))
    await expect(result).rejects.toThrow('Connection lost')
    expect(vi.getTimerCount()).toBe(0)
  })
})
