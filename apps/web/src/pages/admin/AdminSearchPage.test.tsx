// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminSearchOverview, SearchKpis } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/stores/settings', () => ({ useSettings: (select: (state: { animationSpeed: number }) => unknown) => select({ animationSpeed: 1 }) }))
vi.mock('@/i18n/ui', () => {
  const interpolate = (text: string, values?: Record<string, string | number>) => text.replace(/{{\s*([^}\s]+)\s*}}/g, (match, key: string) => String(values?.[key] ?? match))
  return {
    activeLocale: () => 'en-US',
    ui: interpolate,
    uit: (strings: TemplateStringsArray, ...values: Array<string | number>) => strings.reduce((result, part, index) => `${result}${part}${index < values.length ? values[index] : ''}`, ''),
  }
})
import { AdminSearchPage } from './AdminSearchPage'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function kpis(overrides: Partial<SearchKpis> = {}): SearchKpis {
  return {
    searches: 40, timed: 36, p50Ms: 1_800, p90Ms: 4_100, p95Ms: 4_800, failureRate: 0.05, emptyRate: 0.12,
    fallbackRate: 0.25, timeoutRate: 0.04, users: 6, ...overrides,
  }
}

const overview: AdminSearchOverview = {
  window: { from: '2026-11-26T00:00:00.000Z', to: '2026-11-27T00:00:00.000Z', bucket: 'hour', previousFrom: '2026-11-25T00:00:00.000Z' },
  kpis: { current: kpis(), previous: kpis({ searches: 20 }) },
  outcomes: [{ id: 'success', label: 'success', count: 30 }, { id: 'empty', label: 'empty', count: 6 }],
  providers: [
    { provider: 'kagi', category: 'web', attempts: 30, successes: 28, empty: 1, errors: 0, timeouts: 1, p50Ms: 1_700, p90Ms: 3_000, p95Ms: 3_400 },
    { provider: 'firecrawl', category: 'news', attempts: 10, successes: 8, empty: 2, errors: 0, timeouts: 0, p50Ms: 3_200, p90Ms: 5_700, p95Ms: 6_000 },
  ],
  phases: { requestMs: 4, settingsMs: 6, reserveMs: 20, providerMs: 1_900, settleMs: 30, releaseMs: 10, otherMs: 30, totalMs: 2_000 },
  series: [{ bucket: '2026-11-26T10:00', searches: 4, p50Ms: 1_800, p90Ms: 4_000 }],
  providerSeries: [{ bucket: '2026-11-26T10:00', provider: 'kagi', attempts: 4, p50Ms: 1_700, p90Ms: 3_000 }],
  recent: [
    {
      id: 'search-1', createdAt: '2026-11-26T10:05:00.000Z', user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.test' },
      kind: 'query', category: 'news', page: 1, outcome: 'success', provider: 'firecrawl', fallback: true, resultCount: 8, durationMs: 11_250,
      phases: { requestMs: 5, settingsMs: 10, reserveMs: 40, providerMs: 11_000, settleMs: 30, releaseMs: 20 },
      attempts: [
        { provider: 'kagi', outcome: 'timeout', startMs: 60, durationMs: 8_000 },
        { provider: 'firecrawl', outcome: 'success', startMs: 8_100, durationMs: 3_000, resultCount: 8 },
      ],
      queryLength: 18, filters: ['region', 'date'],
    },
  ],
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  mocks.request.mockResolvedValue(overview)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function mount(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}><AdminSearchPage /></MemoryRouter>
    </QueryClientProvider>,
  ))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

describe('AdminSearchPage', () => {
  it('sends the URL range and filters to the Search analytics endpoint', async () => {
    await mount('/admin/usage/search?range=7d&provider=firecrawl&kind=query&outcome=error&ignored=1')
    const path = String(mocks.request.mock.calls[0]?.[0])
    expect(path.startsWith('/api/admin/analytics/search?')).toBe(true)
    const params = new URL(path, 'http://test').searchParams
    expect(Object.fromEntries(params)).toMatchObject({ range: '7d', provider: 'firecrawl', kind: 'query', outcome: 'error' })
    expect(params.has('ignored')).toBe(false)
    expect(params.get('timeZone')).toBeTruthy()
  })

  it('shows latency KPIs, per-provider latency and the phase split', async () => {
    await mount('/admin/usage/search')
    const text = container.textContent ?? ''
    expect(text).toContain('1.8 s')
    expect(text).toContain('4.8 s')
    expect(text).toContain('25%')
    const providerRow = Array.from(container.querySelectorAll('tr')).find((row) => row.textContent?.startsWith('Firecrawl'))
    expect(Array.from(providerRow?.querySelectorAll('td') ?? [], (cell) => cell.textContent)).toEqual(['Firecrawl', 'News', '10', '3.2 s', '5.7 s', '6 s', '20%', '0%', '0%'])
    expect(text).toContain('Average 2 s per search; 100 ms outside provider calls')
  })

  it('draws a waterfall of each recent search and expands its attempts', async () => {
    await mount('/admin/usage/search')
    const row = container.querySelector('[data-search-id="search-1"]')!
    expect(row.textContent).toContain('Ada Lovelace')
    expect(row.textContent).toContain('fallback')
    const waterfall = row.querySelector('[role="img"]')!
    expect(waterfall.getAttribute('aria-label')).toBe('Auth and parsing 5 ms, Settings lookup 10 ms, Kagi: Timed out 8 s, Firecrawl: Success 3 s')
    expect(container.textContent).not.toContain('Provider attempts')
    await act(async () => (row as HTMLElement).click())
    expect(container.textContent).toContain('Provider attempts')
    expect(container.textContent).toContain('18 characters')
    expect(container.textContent).toContain('Region, Date')
  })
})
