import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return { ApiError }
})
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }))
vi.mock('../../api/client', () => ({ ApiError: mocks.ApiError, apiRequest: vi.fn(), apiUrl: vi.fn(), nativeAuthorizationHeaders: vi.fn() }))
import { failurePhase, statusPhase } from './phase'

const ready = { state: 'ready' as const, width: 1_280, height: 800, controlled: false }

describe('statusPhase', () => {
  it('says watching is billed only when a minute costs something', () => {
    expect(statusPhase({ ...ready, pricePerMinuteMicros: 1_500 })).toEqual({ kind: 'ready', screen: { width: 1_280, height: 800 }, billed: true })
    expect(statusPhase({ ...ready, pricePerMinuteMicros: 0 })).toMatchObject({ billed: false })
    expect(statusPhase(ready)).toMatchObject({ billed: false })
  })

  it('shows the message for a chat without a screen', () => {
    expect(statusPhase({ ...ready, state: 'none' })).toEqual({ kind: 'none' })
    expect(statusPhase({ ...ready, state: 'unavailable' })).toEqual({ kind: 'unavailable' })
  })
})

describe('failurePhase', () => {
  it('shows the unfunded state, with no retry, for a refused minute', () => {
    expect(failurePhase(new mocks.ApiError(402, 'insufficient_balance', 'Usage limit'))).toEqual({ kind: 'unfunded' })
  })

  it('offers a retry for anything else', () => {
    expect(failurePhase(new mocks.ApiError(502, 'workspace_screen_unreachable', 'Unreachable'))).toEqual({ kind: 'error', message: 'Unreachable' })
    expect(failurePhase(undefined)).toEqual({ kind: 'error', message: "Couldn't open the screen." })
  })
})
