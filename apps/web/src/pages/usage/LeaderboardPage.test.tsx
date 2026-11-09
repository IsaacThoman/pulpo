// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
  return { request: vi.fn() }
})
vi.mock('@/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))
vi.mock('recharts', async (importOriginal) => ({
  ...await importOriginal<typeof import('recharts')>(), ResponsiveContainer: () => null,
}))
const { useAuth } = await import('@/stores/auth')
const { LeaderboardPage } = await import('./LeaderboardPage')

const row = { userId: 'friend-1', displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null, calls: 2, tokens: 30, costMicros: 1_000 }

beforeEach(() => {
  useAuth.setState({ user: { id: 'me', username: 'me' } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
  mocks.request.mockImplementation(async (path: string) => {
    if (path.includes('/records?')) return { data: [], nextCursor: null }
    if (path.includes('/activity?')) return { summary: { calls: 2, inputTokens: 20, outputTokens: 10, costMicros: 1_000, firstUsedAt: null }, daily: [], contribution: [], topModels: [] }
    return { data: [path.startsWith('/api/admin/') ? { ...row, balanceMicros: 5_000_000 } : row] }
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mount(scope: 'friends' | 'instance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><LeaderboardPage scope={scope} /></TooltipProvider></MemoryRouter></QueryClientProvider>)
}

it('never offers a balance ranking for friends, which the API no longer reports', async () => {
  mount('friends')
  await screen.findByText('Friends ranking')
  expect(screen.getByRole('button', { name: 'Tokens' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Balance' })).toBeNull()
  expect(mocks.request).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/usage\/leaderboard\?.*scope=friends/), expect.anything())
})

it('keeps the balance ranking on the admin instance leaderboard', async () => {
  mount('instance')
  await screen.findByText('Instance ranking')
  expect(screen.getByRole('button', { name: 'Balance' })).toBeTruthy()
})
