import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest } from './api'
import { queryClient } from './query-client'

let client: QueryClient
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { onLine: true })
  client = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() })
})
afterEach(() => {
  client.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('query retries', () => {
  it.each(['60', 'date'])('waits for Retry-After (%s) before retrying a real API failure', async (header) => {
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    const retryAfter = header === 'date' ? 'Mon, 12 Oct 2026 12:01:00 GMT' : header
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'retry-after': retryAfter } }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const result = client.fetchQuery({ queryKey: ['limited'], queryFn: () => apiRequest('/api/me') })

    await vi.advanceTimersByTimeAsync(59_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, 'invalid', '2147484'])('does not hammer a 429 with unusable Retry-After (%s)', async (retryAfter) => {
    const fetchMock = vi.fn(async () => Response.json({}, {
      status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {},
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = client.fetchQuery({ queryKey: ['limited'], queryFn: () => apiRequest('/api/me') })
    const assertion = expect(result).rejects.toMatchObject({ status: 429 })
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits for each new rate limit delay and stops after two retries', async () => {
    const fetchMock = vi.fn(async () => Response.json({}, { status: 429, headers: { 'retry-after': '60' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = client.fetchQuery({ queryKey: ['limited'], queryFn: () => apiRequest('/api/me') })
    const assertion = expect(result).rejects.toMatchObject({ status: 429 })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps exponential backoff and the existing retry budget for other failures', async () => {
    const queryFn = vi.fn(async () => { throw new ApiError(500, 'internal_error', 'Failed') })
    const result = client.fetchQuery({ queryKey: ['failed'], queryFn })
    const assertion = expect(result).rejects.toMatchObject({ status: 500 })
    await vi.advanceTimersByTimeAsync(999)
    expect(queryFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(queryFn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000)
    await assertion
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it('does not retry aborted queries', async () => {
    const queryFn = vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') })
    await expect(client.fetchQuery({ queryKey: ['aborted'], queryFn })).rejects.toMatchObject({ name: 'AbortError' })
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
