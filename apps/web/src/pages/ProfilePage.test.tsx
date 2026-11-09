// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SettingsDialogProvider } from '@/components/settings/settings-dialog'
import { ProfilePage } from './ProfilePage'

const mocks = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
  return { request: vi.fn(), openSettings: vi.fn() }
})
vi.mock('@/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))
// Keep the real chart legend, but avoid measuring the chart canvas in jsdom.
vi.mock('recharts', async (importOriginal) => ({
  ...await importOriginal<typeof import('recharts')>(), ResponsiveContainer: () => null,
}))

const viewerId = '00000000-0000-4000-8000-0000000000aa'
const friendId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000003'
const model = { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', logo: 'zhipu' }
let detail: FriendProfileDetail
let location: ReturnType<typeof useLocation>

function LocationProbe() {
  location = useLocation()
  return null
}

function mount(path = '/alice') {
  return render(<QueryClientProvider client={queryClient}>
    <SettingsDialogProvider controller={{ openSettings: mocks.openSettings }}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/:username" element={<ProfilePage />} /></Routes>
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </SettingsDialogProvider>
  </QueryClientProvider>)
}

const activity = (extra: object = {}) => ({
  summary: { calls: 3, inputTokens: 100, outputTokens: 50, costMicros: 2_500_000, inferenceReferenceCostMicros: 0, firstUsedAt: '2026-09-20T00:00:00Z' },
  daily: [{ day: '2026-09-20', modelId: model.id, calls: 3, inputTokens: 100, outputTokens: 50, costMicros: 2_500_000 }],
  contribution: [],
  topModels: [{ modelId: model.id, name: model.name, logo: model.logo, calls: 3, costMicros: 2_500_000 }],
  modelNames: { [model.id]: model.name },
  ...extra,
})
const publicRecords = {
  data: [{
    id: 'usage-1', createdAt: '2026-09-20T00:00:00Z',
    participant: { id: friendId, displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null },
    model, inputTokens: 100, outputTokens: 50, costMicros: 2_500_000, inferenceReferenceCostMicros: 0, subscriptionCoveredMicros: 0, costBreakdown: null,
  }],
  nextCursor: null,
}

const usageRequests = () => mocks.request.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('usage'))

beforeEach(() => {
  useCatalog.setState({ models: [], loaded: true })
  useAuth.setState({
    billingEnabled: false,
    user: {
      id: viewerId, name: 'Morgan Viewer', email: 'morgan@example.com', username: 'morgan', avatarUrl: null, profileColor: null,
      usageVisibility: 'friends', role: 'user', initials: 'MV', balanceMicros: 7_000_000, storageLimitBytes: 0, blocked: false,
      stateRevision: 1, createdAt: '2026-09-01T00:00:00Z',
    },
  })
  detail = {
    profile: { id: friendId, displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null },
    relationship: 'friends',
    requestId,
    friendsSince: '2026-09-01T12:00:00.000Z',
    mutualFriends: [{ id: '00000000-0000-4000-8000-000000000002', displayName: 'Bob', username: 'bob', avatarUrl: null, profileColor: null }],
    usageVisible: true,
  }
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } })
  mocks.openSettings.mockReset()
  mocks.request.mockReset().mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method) return {}
    if (path === '/api/profiles/alice') return structuredClone(detail)
    if (path.startsWith('/api/profiles/alice/usage/activity?')) return activity()
    if (path.startsWith('/api/profiles/alice/usage/records?')) return structuredClone(publicRecords)
    if (path.startsWith('/api/usage/activity?')) return activity({ balanceMicros: 12_340_000, balanceKind: 'pool' })
    if (path.startsWith('/api/usage/records?')) return {
      data: [{
        id: 'own-1', createdAt: '2026-09-20T00:00:00Z', userId: viewerId, modelId: model.id, model, inputTokens: 100, outputTokens: 50,
        costMicros: 2_500_000, inferenceReferenceCostMicros: 0, subscriptionCoveredMicros: 0, costBreakdown: null, latencyMs: 40, balanceAfterMicros: 12_340_000,
      }],
      nextCursor: null,
    }
    throw new Error(`Unexpected API request: ${path}`)
  })
})
afterEach(() => { cleanup(); queryClient.clear() })

describe('profile page', () => {
  it('loads an accepted friend by username and links mutual friends by username', async () => {
    mount()

    await screen.findByRole('heading', { name: 'Alice' })
    expect(mocks.request).toHaveBeenCalledWith('/api/profiles/alice')
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText(/Friends since/)).toBeTruthy()
    expect(screen.getByText('Friends')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Bob' }).getAttribute('href')).toBe('/bob')
    expect(screen.getByRole('link', { name: 'Back to friends' }).getAttribute('href')).toBe('/friends')
  })

  it('shows shared usage from the profile endpoints without balances or a user column', async () => {
    const { container } = mount()

    await screen.findByRole('heading', { name: 'Top models' })
    expect(usageRequests().every((path) => path.startsWith('/api/profiles/alice/usage/'))).toBe(true)
    expect(usageRequests().some((path) => path.startsWith('/api/profiles/alice/usage/activity?range=30d'))).toBe(true)
    expect(usageRequests().some((path) => path.startsWith('/api/profiles/alice/usage/records?range=30d') && path.includes('limit=50'))).toBe(true)
    const records = screen.getByRole('region', { name: 'Recent usage' })
    expect(within(records).getByText(model.name)).toBeTruthy()
    expect(within(records).queryByRole('columnheader', { name: 'User' })).toBeNull()
    expect(screen.getByText('3 calls')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Balance|Add credits/)
    expect(screen.getByRole('link', { name: 'Compare with friends' }).getAttribute('href')).toBe('/friends/leaderboard')
    expect(screen.queryByRole('button', { name: /Usage visible/ })).toBeNull()
  })

  it('explains usage that is not shared without requesting it or naming the setting', async () => {
    detail = { ...detail, relationship: 'none', requestId: null, friendsSince: null, usageVisible: false }
    mount()

    await screen.findByText("Alice hasn't shared their usage with you.")
    expect(usageRequests()).toEqual([])
    expect(screen.queryByText('Usage overview')).toBeNull()
    expect(screen.queryByText(/pool|public/i)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Compare with friends' })).toBeNull()
    expect(screen.getByText('Mutual friends')).toBeTruthy()
  })

  it('hides cached usage once the profile stops sharing it', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Top models' })

    detail = { ...detail, usageVisible: false }
    const forbidden = new ApiError(403, 'usage_private', "This profile's usage is private")
    const fallback = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.includes('/usage/')) throw forbidden
      return fallback(path, options)
    })
    await queryClient.refetchQueries({ queryKey: ['profile-usage', viewerId, 'alice'] })

    await screen.findByText("Alice hasn't shared their usage with you.")
    expect(screen.queryByRole('heading', { name: 'Top models' })).toBeNull()
    await waitFor(() => expect(queryClient.getQueryData(['friend-profile', 'alice'])).toMatchObject({ usageVisible: false }))
    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ['profile-usage'] })).toHaveLength(0))
    expect(screen.queryByRole('link', { name: 'Compare with friends' })).toBeNull()
  })

  it('lets the viewer request a non-friend from their profile', async () => {
    detail = { ...detail, relationship: 'none', requestId: null, friendsSince: null, mutualFriends: [] }
    mocks.request.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.includes('/usage/')) return path.includes('/records?') ? { data: [], nextCursor: null } : activity()
      if (!options?.method) return structuredClone(detail)
      detail = { ...detail, relationship: 'outgoing', requestId }
      return { requestId, status: 'pending' }
    })
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Add friend' }))

    await screen.findByRole('button', { name: 'Cancel request' })
    expect(mocks.request).toHaveBeenCalledWith('/api/friends/requests', { method: 'POST', body: { userId: friendId } })
    await waitFor(() => expect(queryClient.getQueryState(['friend-profile', 'alice'])?.fetchStatus).toBe('idle'))
  })

  it('hides the cached profile once a refetch says it no longer exists', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Alice' })

    mocks.request.mockRejectedValue(new ApiError(404, 'not_found', 'Profile not found'))
    await queryClient.refetchQueries({ queryKey: ['friend-profile', 'alice'] })

    await screen.findByText('Profile not found')
    expect(screen.queryByRole('heading', { name: 'Alice' })).toBeNull()
    expect(screen.queryByText('Mutual friends')).toBeNull()
  })
})

describe('own profile', () => {
  it('shows the former usage page with the avatar beside the name', async () => {
    const { container } = mount('/morgan')

    const name = await screen.findByRole('heading', { name: 'Morgan Viewer' })
    const avatar = container.querySelector('[data-slot="avatar"]')!
    expect(avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(avatar.className).toContain('rounded-full')
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy()
    expect(screen.getByText('@morgan')).toBeTruthy()
    expect(screen.getByText(/morgan@example\.com · Joined/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Back to friends' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Compare with friends' }).getAttribute('href')).toBe('/friends/leaderboard')

    await screen.findByRole('heading', { name: 'Top models' })
    expect(screen.getByText('Balance (pooled)').nextElementSibling?.textContent).toBe('$12.34')
    expect(within(screen.getByRole('region', { name: 'Recent usage' })).getByRole('columnheader', { name: 'Balance after' })).toBeTruthy()
    expect(usageRequests().some((path) => path.startsWith('/api/usage/activity?'))).toBe(true)
    expect(usageRequests().some((path) => path.startsWith('/api/usage/records?'))).toBe(true)
    expect(mocks.request).not.toHaveBeenCalledWith('/api/profiles/morgan')
    expect(screen.queryByText('Mutual friends')).toBeNull()
  })

  it('shows who can see your usage and opens Profile settings to change it', async () => {
    useAuth.setState((state) => ({ user: state.user && { ...state.user, usageVisibility: 'public' } }))
    mount('/morgan')

    fireEvent.click(await screen.findByRole('button', { name: 'Usage visible to everyone' }))
    expect(mocks.openSettings).toHaveBeenCalledWith('profile')
  })

  it('moves a non-canonical own handle to the canonical URL', async () => {
    mount('/Morgan')
    await screen.findByRole('heading', { name: 'Morgan Viewer' })
    await waitFor(() => expect(location.pathname).toBe('/morgan'))
    expect(mocks.request).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/profiles\//))
  })
})
