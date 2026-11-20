import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return { ApiError, fetch: vi.fn(), apiRequest: vi.fn() }
})
vi.mock('expo/fetch', () => ({ fetch: mocks.fetch }))
vi.mock('../../api/client', () => ({
  ApiError: mocks.ApiError,
  apiRequest: mocks.apiRequest,
  apiUrl: (path: string) => `https://pulpo.test${path}`,
  nativeAuthorizationHeaders: () => ({}),
}))
import { fetchWorkspaceScreenFrame, fetchWorkspaceScreenPresence, isUnfundedError } from './api'

function response(status: number, body?: unknown) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(), json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) }
}

afterEach(() => {
  mocks.fetch.mockReset()
  mocks.apiRequest.mockReset()
})

describe('fetchWorkspaceScreenFrame', () => {
  it('answers unfunded when the server refuses the next minute', async () => {
    mocks.fetch.mockResolvedValue(response(402, { error: { code: 'insufficient_balance', message: 'Insufficient balance' } }))
    await expect(fetchWorkspaceScreenFrame('chat-1', undefined, 1_000, new AbortController().signal)).resolves.toEqual({ kind: 'unfunded' })
  })

  it('fails on another payment error, for the loop to retry', async () => {
    mocks.fetch.mockResolvedValue(response(402, { error: { code: 'daily_spend_limit_reached' } }))
    const failure = fetchWorkspaceScreenFrame('chat-1', undefined, 1_000, new AbortController().signal)
    await expect(failure).rejects.toMatchObject({ status: 402, code: 'daily_spend_limit_reached' })
  })
})

describe('isUnfundedError', () => {
  it('recognises the 402 of a control or input request', () => {
    expect(isUnfundedError(new mocks.ApiError(402, 'insufficient_balance', 'Out'))).toBe(true)
    expect(isUnfundedError(new mocks.ApiError(402, 'daily_spend_limit_reached', 'Out'))).toBe(false)
    expect(isUnfundedError(new mocks.ApiError(409, 'insufficient_balance', 'Out'))).toBe(false)
    expect(isUnfundedError(new Error('offline'))).toBe(false)
  })
})

describe('fetchWorkspaceScreenPresence', () => {
  it('asks the presence route and checks the answer', async () => {
    mocks.apiRequest.mockResolvedValue({ live: true, expiresAt: '2026-11-20T12:30:00Z' })
    await expect(fetchWorkspaceScreenPresence('chat 1')).resolves.toEqual({ live: true, expiresAt: '2026-11-20T12:30:00Z' })
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/chats/chat%201/workspace-screen/presence', { signal: undefined })
    mocks.apiRequest.mockResolvedValue({ live: 'yes' })
    await expect(fetchWorkspaceScreenPresence('chat-1')).rejects.toThrow()
  })
})
