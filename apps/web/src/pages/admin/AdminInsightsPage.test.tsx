// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsWindow, InsightsEngagement, InsightsModels, InsightsSettings } from '@pulpo/contracts'

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
import { AdminInsightsPage } from './AdminInsightsPage'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const analyticsWindow: AnalyticsWindow = { from: '2026-09-03T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z', bucket: 'day', previousFrom: null }

const models: InsightsModels = {
  window: analyticsWindow, totalRequests: 3, series: [{ bucket: '2026-10-01T00:00', modelId: 'gpt', requests: 3 }],
  models: [{ modelId: 'gpt', modelName: 'GPT Test', requests: 3, previousRequests: 2, users: 1, costMicros: 3_000, avgCostMicros: 1_000, successRate: 1, ttftP50Ms: 400, durationP50Ms: 1_200 }],
  redirects: [], modelNames: { gpt: 'GPT Test', other: 'Other' },
}

const settings: InsightsSettings = {
  window: analyticsWindow, totalRequests: 200, presets: [], reasoningEffort: [{ id: 'unknown', label: 'Model default', count: 50 }],
  verbosity: [], temperature: [], customInstructions: 10, memoryEnabled: 25, instructionPresets: [], settingsCaptured: 50,
}

const engagement: InsightsEngagement = {
  window: analyticsWindow, dau: 2, wau: 4, mau: 8, activeUsers: 8, newUsers: 3, returningUsers: 5, activeSeries: [],
  cohorts: [{ cohortStart: '2026-09-07', size: 4, retention: [1, 0.5, 0.25] }],
  concentration: { top1PctShare: 0.4, top10PctShare: 0.7, top10UsersShare: 0.9 }, topUsers: [],
}

function respond(path: string) {
  if (path.includes('/insights/settings')) return settings
  if (path.includes('/insights/engagement')) return engagement
  return models
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  mocks.request.mockImplementation(async (path: string) => respond(path))
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
      <MemoryRouter initialEntries={[url]}><AdminInsightsPage /></MemoryRouter>
    </QueryClientProvider>,
  ))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const requestedPaths = () => mocks.request.mock.calls.map(([path]) => String(path))

describe('AdminInsightsPage', () => {
  it('sends the URL range and filters to the active section endpoint', async () => {
    await mount('/admin/usage/insights?range=7d&platform=ios&plan=fat&origin=api&model=gpt')
    const modelsPath = requestedPaths().find((path) => path.startsWith('/api/admin/analytics/insights/models?') && path.includes('model=gpt'))
    expect(modelsPath).toBeDefined()
    const params = new URL(modelsPath!, 'http://test').searchParams
    expect(params.get('range')).toBe('7d')
    expect(params.get('platform')).toBe('ios')
    expect(params.get('plan')).toBe('fat')
    expect(params.get('origin')).toBe('api')
    expect(params.get('timeZone')).toBeTruthy()
    expect(container.textContent).toContain('GPT Test')
    // Sections load lazily: only the visible one is requested.
    expect(requestedPaths().some((path) => path.includes('/insights/engagement'))).toBe(false)
  })

  it('defaults to the last 30 days', async () => {
    await mount('/admin/usage/insights')
    expect(requestedPaths().every((path) => new URL(path, 'http://test').searchParams.get('range') === '30d')).toBe(true)
  })

  it('renders retention cohorts as visible percentages', async () => {
    await mount('/admin/usage/insights?section=engagement')
    const cells = Array.from(container.querySelectorAll('tbody tr')[0]?.querySelectorAll('td') ?? [], (cell) => cell.textContent)
    expect(cells.slice(1, 5)).toEqual(['4', '100%', '50%', '25%'])
    expect(cells.slice(5).every((text) => text === '')).toBe(true)
  })

  it('notes partial settings coverage and labels model defaults', async () => {
    await mount('/admin/usage/insights?section=settings')
    expect(container.querySelector('[role="note"]')?.textContent).toContain('25%')
    expect(container.textContent).toContain('Model default')
    // Shares use captured settings as the denominator: 25 of 50 have memory on.
    expect(container.textContent).toContain('50%')
  })

  it('hides the coverage note when every request has settings', async () => {
    mocks.request.mockImplementation(async (path: string) => path.includes('/insights/settings') ? { ...settings, settingsCaptured: 200 } : respond(path))
    await mount('/admin/usage/insights?section=settings')
    expect(container.querySelector('[role="note"]')).toBeNull()
  })
})
