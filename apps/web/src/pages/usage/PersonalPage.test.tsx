// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { useCatalog } from '@/stores/catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PersonalPage } from './PersonalPage'

const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  return { request: vi.fn() }
})
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/stores/settings', () => ({ useSettings: (select: (state: unknown) => unknown) => select({ animationSpeed: 1 }) }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({
  user: { id: 'me', name: 'Me', email: 'me@example.com', createdAt: '2026-09-01T00:00:00Z' }, billingEnabled: false,
}) }))
// Keep the real chart legend, but avoid measuring the chart canvas in jsdom.
vi.mock('recharts', async (importOriginal) => ({
  ...await importOriginal<typeof import('recharts')>(), ResponsiveContainer: () => null,
}))

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('uses friendly usage names and logos throughout the page with an empty selectable catalog', async () => {
  useCatalog.setState({ models: [], loaded: true, codexEnabled: false })
  const models = [
    { modelId: 'glm-5.3-flash', name: 'GLM-5.3 Flash', logo: 'zhipu', calls: 675, costMicros: 6_121_100 },
    { modelId: 'codex:gpt-5.6-sol', name: 'GPT-5.6 Sol', logo: 'openai', calls: 26, costMicros: 317_100 },
    { modelId: 'codex:gpt-6-astra', name: 'GPT-6 Astra', logo: 'openai', calls: 5, costMicros: 73_600 },
  ]
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/usage/activity?')) return {
      summary: { calls: 706, inputTokens: 1000, outputTokens: 500, costMicros: 6_511_800, inferenceReferenceCostMicros: 6_511_800, firstUsedAt: '2026-09-20T00:00:00Z' },
      daily: models.map((model) => ({ ...model, day: '2026-09-20', inputTokens: 100, outputTokens: 50 })),
      contribution: [], topModels: models, modelNames: Object.fromEntries(models.map((model) => [model.modelId, model.name])),
      balanceMicros: 10_000_000, balanceKind: 'account',
    }
    if (path.startsWith('/api/usage/records?')) return {
      data: models.map((model, index) => ({
        id: `usage-${index}`, createdAt: '2026-09-20T00:00:00Z', userId: 'me', modelId: model.modelId,
        model: { id: model.modelId, name: model.name, logo: model.logo }, inputTokens: 100, outputTokens: 50,
        costMicros: 100, inferenceReferenceCostMicros: 100, subscriptionCoveredMicros: 0,
        latencyMs: 50, balanceAfterMicros: 10_000_000,
      })), nextCursor: null,
    }
    throw new Error(`Unexpected API request: ${path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const { container } = render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><PersonalPage /></TooltipProvider></MemoryRouter></QueryClientProvider>)
  try {
    await screen.findByRole('heading', { name: 'Top models' })
    const ranking = screen.getByRole('heading', { name: 'Top models' }).parentElement!.parentElement!
    for (const model of models) {
      // Each name appears in the chart legend, recent usage, and ranking.
      expect(screen.getAllByText(model.name)).toHaveLength(3)
      expect(within(ranking).getByText(model.name)).toBeTruthy()
      expect(container.textContent).not.toContain(model.modelId)
    }
    expect(within(ranking).getByText('675 calls')).toBeTruthy()
    expect(within(ranking).getByText('$6.1211')).toBeTruthy()
    expect(container.querySelectorAll('img[src="/ai-icons/openai.svg"]')).toHaveLength(4)
    expect(container.querySelector('img[src="/pulpo-smiley.png"]')).toBeNull()
    expect(container.textContent).not.toContain('glm-5.3-flash-fireworks')
  } finally {
    client.clear()
  }
})
