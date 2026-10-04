// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminRequestPage, AdminRequestRow, AdminRequestsOverview, AdminUsageEvent, RequestKpis } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  io: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false, runtimeInstanceUrl: () => '', runtimeSessionToken: () => null }))
vi.mock('@/lib/session-revocation', () => ({ handleSessionConnectionError: vi.fn() }))
vi.mock('socket.io-client', () => ({ io: mocks.io }))
vi.mock('@/stores/settings', () => ({ useSettings: (select: (state: { animationSpeed: number }) => unknown) => select({ animationSpeed: 1 }) }))
vi.mock('../DiagnosticAttempts', () => ({ DiagnosticAttempts: () => null }))
vi.mock('@/i18n/ui', () => {
  const ui = (text: string, values?: Record<string, string | number>) => text.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => String(values?.[key] ?? ''))
  return {
    ui,
    uit: (strings: TemplateStringsArray, ...values: Array<string | number>) => strings.reduce((out, part, index) => out + part + (index < values.length ? values[index] : ''), ''),
    activeLocale: () => 'en-US',
  }
})

import { AdminUsagePage } from '../AdminUsagePage'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function kpis(overrides: Partial<RequestKpis> = {}): RequestKpis {
  return {
    requests: 120, completed: 110, failed: 8, cancelled: 1, incomplete: 1, inFlight: 0,
    successRate: 0.9, errorRate: 0.1, ttftP50Ms: 400, ttftP95Ms: 1200, durationP50Ms: 3000, durationP95Ms: 9000,
    costMicros: 5_000_000, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 0, users: 4,
    ...overrides,
  }
}

const overview: AdminRequestsOverview = {
  window: { from: '2026-10-02T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z', bucket: 'hour', previousFrom: '2026-10-01T00:00:00.000Z' },
  kpis: { current: kpis(), previous: kpis({ requests: 100 }) },
  series: [],
  errors: { byCategory: [], byModel: [], topMessages: [] },
  reliability: [],
  fallbackPaths: [],
  topModels: [{ id: 'gpt-x', label: 'GPT X', count: 120 }],
  topUsers: [{ id: USER_ID, label: 'Ada Lovelace', count: 50, costMicros: 1_000_000 }],
  topApiKeys: [],
  modelNames: { 'gpt-x': 'GPT X' },
}

function row(id: string, overrides: Partial<AdminRequestRow> = {}): AdminRequestRow {
  return {
    id, responseId: `resp-${id}`, createdAt: '2026-10-02T12:00:00.000Z', status: 'in_progress', origin: 'web', platform: 'web',
    user: { id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.test' }, apiKey: null,
    requestedModelId: 'gpt-x', actualModelId: null, agentMode: false, retryCount: 0, fallbackUsed: false, stickyFallbackUsed: false,
    ocrStatus: 'not_requested', errorCategory: null, errorMessage: null, inputTokens: 10, cachedInputTokens: 0, outputTokens: 5,
    reasoningTokens: 0, costMicros: 0, ttftMs: null, durationMs: 100, tokensPerSecond: null, attempts: 1, toolCalls: 0,
    ...overrides,
  }
}

let pages: Record<string, AdminRequestPage>

function event(requestId: string, overrides: Partial<AdminUsageEvent> = {}): AdminUsageEvent {
  return {
    requestId, responseId: `resp-${requestId}`, status: 'in_progress', elapsedMs: 2500, currentModelId: 'gpt-x', retryAttempt: 0,
    turnNumber: null, retryCount: 0, fallbackUsed: false, ocrStatus: 'not_requested', eventCount: 1,
    inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, updatedAt: '2026-10-02T12:00:01.000Z',
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function mount(initial = '/admin/usage/requests') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <AdminUsagePage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const calls = () => mocks.request.mock.calls.map(([url]) => String(url))
const listCalls = () => calls().filter((url) => url.startsWith('/api/admin/analytics/requests?'))
const overviewCalls = () => calls().filter((url) => url.startsWith('/api/admin/analytics/requests/overview'))
/** React Query batches cache notifications on a zero-delay timer. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tableRow = (id: string) => document.querySelector<HTMLTableRowElement>(`tr[data-request-id="${id}"]`)!

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  mocks.handlers.clear()
  mocks.io.mockImplementation(() => ({
    on: (name: string, handler: (...args: unknown[]) => void) => { mocks.handlers.set(name, handler) },
    emit: mocks.emit,
    disconnect: mocks.disconnect,
  }))
  pages = { first: { data: [row('r1')], nextCursor: null } }
  mocks.request.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/admin/analytics/requests/overview')) return overview
    if (url.startsWith('/api/admin/analytics/requests?')) {
      const cursor = new URLSearchParams(url.split('?')[1]).get('cursor')
      return cursor ? pages[cursor] : pages.first
    }
    throw new Error(`unexpected ${url}`)
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('admin requests dashboard', () => {
  it('renders KPI deltas against the previous period', async () => {
    mount()
    const label = await screen.findByText('Requests', { selector: 'div' })
    const tile = label.parentElement!
    await waitFor(() => expect(within(tile).getByText('120')).toBeTruthy())
    expect(within(tile).getByText('20% vs previous period')).toBeTruthy()
  })

  it('sends URL filters to the API and writes clicked filters to the URL', async () => {
    mount('/admin/usage/requests?range=7d&status=failed&agent=true')
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThan(0))
    const first = new URLSearchParams(overviewCalls()[0]!.split('?')[1])
    expect(first.get('range')).toBe('7d')
    expect(first.get('status')).toBe('failed')
    expect(first.get('agent')).toBe('true')
    expect(new URLSearchParams(listCalls()[0]!.split('?')[1]).get('status')).toBe('failed')

    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace', pressed: false }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(`userId=${USER_ID}`))
    await waitFor(() => expect(listCalls().some((url) => url.includes(`userId=${USER_ID}`))).toBe(true))
    expect(overviewCalls().some((url) => url.includes(`userId=${USER_ID}`))).toBe(true)
    expect(screen.getByRole('button', { name: 'Remove filter' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?range=7d'))
  })

  it('loads more rows with the returned cursor', async () => {
    pages = {
      first: { data: [row('r1', { status: 'completed' })], nextCursor: 'cursor-2' },
      'cursor-2': { data: [row('r2', { status: 'completed' })], nextCursor: null },
    }
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(tableRow('r2')).toBeTruthy())
    expect(listCalls().at(-1)).toContain('cursor=cursor-2')
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('does not open a socket unless live mode is on', async () => {
    mount()
    await waitFor(() => expect(tableRow('r1')).toBeTruthy())
    expect(mocks.io).not.toHaveBeenCalled()
  })

  it('patches loaded rows from live events and debounces refetches for new requests', async () => {
    mount('/admin/usage/requests?live=1')
    await waitFor(() => expect(tableRow('r1')).toBeTruthy())
    act(() => mocks.handlers.get('connect')!())
    expect(mocks.emit).toHaveBeenCalledWith('admin.usage.subscribe')

    vi.useFakeTimers()
    const upsert = mocks.handlers.get('admin.usage.upsert')!
    const before = mocks.request.mock.calls.length

    act(() => upsert(event('r1', { outputTokens: 490, retryCount: 2 })))
    await flush()
    expect(within(tableRow('r1')).getByText('500')).toBeTruthy()
    expect(within(tableRow('r1')).getByText('2 retries')).toBeTruthy()
    expect(within(tableRow('r1')).getByText('2.5 s')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(mocks.request.mock.calls.length).toBe(before)

    act(() => {
      upsert(event('new-1'))
      upsert(event('new-2'))
      upsert(event('new-3'))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(mocks.request.mock.calls.length).toBe(before)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(listCalls().length).toBe(2)
    expect(overviewCalls().length).toBe(2)

    act(() => upsert(event('new-4')))
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(listCalls().length).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(listCalls().length).toBe(3)
  })

  it('refetches once when a loaded request finishes', async () => {
    mount('/admin/usage/requests?live=1')
    await waitFor(() => expect(tableRow('r1')).toBeTruthy())
    vi.useFakeTimers()
    const upsert = mocks.handlers.get('admin.usage.upsert')!
    act(() => upsert(event('r1', { status: 'completed' })))
    await flush()
    expect(within(tableRow('r1')).getByText('Completed')).toBeTruthy()
    act(() => upsert(event('r1', { status: 'completed' })))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(listCalls().length).toBe(2)
  })
})
