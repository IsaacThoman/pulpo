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
  return { request: vi.fn(), openSettings: vi.fn(), pendingFriendRequests: 0 }
})
vi.mock('@/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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

function mount(path = '/alice', state?: unknown) {
  return render(<QueryClientProvider client={queryClient}>
    <SettingsDialogProvider controller={{ openSettings: mocks.openSettings }}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
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

const breadcrumb = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
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
    usageVisibility: 'friends',
    joinedAt: '2026-08-15T12:00:00.000Z',
  }
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } })
  mocks.openSettings.mockReset()
  mocks.pendingFriendRequests = 0
  mocks.request.mockReset().mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method) return {}
    if (path === '/api/friends/pending-count') return { count: mocks.pendingFriendRequests }
    if (path === '/api/pools/pending-count') return { count: 0 }
    if (path === '/api/profiles/alice') return structuredClone(detail)
    if (path === '/api/profiles/bob') return { ...structuredClone(detail), profile: detail.mutualFriends[0], mutualFriends: [], usageVisible: false }
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
    // Someone else's profile isn't one of People's tabs.
    expect(screen.queryByRole('navigation', { name: 'Usage sections' })).toBeNull()
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText(/^Joined /)).toBeTruthy()
    expect(screen.queryByText(/Friends since/)).toBeNull()
    expect(screen.getByText('Friends', { selector: 'span' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Bob' }).getAttribute('href')).toBe('/bob')
  })

  it("shows someone else's usage visibility as an icon beside their handle", async () => {
    detail = { ...detail, relationship: 'none', requestId: null, friendsSince: null, usageVisible: false, usageVisibility: 'pool' }
    mount()

    const icon = await screen.findByRole('img', { name: 'Usage visible to their Pool' })
    const handle = screen.getByText('@alice')
    expect(icon.parentElement).toBe(handle.parentElement)
    expect(handle.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.focus(icon)
    expect((await screen.findByRole('tooltip')).textContent).toContain('Usage visible to their Pool')
    // Someone else's setting is read-only here.
    fireEvent.click(icon)
    expect(mocks.openSettings).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Usage visible/ })).toBeNull()
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
    // Phones collapse Compare to its icon so the breadcrumb's origin stays readable beside it.
    expect(screen.getByText('Compare with friends').className).toBe('max-sm:sr-only')
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

  it("shows a public non-friend's usage without offering a friends comparison they aren't in", async () => {
    detail = { ...detail, relationship: 'none', requestId: null, friendsSince: null, usageVisible: true }
    mount()

    await screen.findByRole('heading', { name: 'Top models' })
    expect(within(screen.getByRole('region', { name: 'Recent usage' })).getByText(model.name)).toBeTruthy()
    expect(screen.queryByText("Alice hasn't shared their usage with you.")).toBeNull()
    expect(breadcrumb().getByRole('link', { name: 'Friends' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Compare with friends' })).toBeNull()
  })

  it('waits for a fresh profile when the cached one predates usage visibility', async () => {
    const { usageVisible: _, usageVisibility: _level, joinedAt: _joined, ...cached } = detail
    queryClient.setQueryData(['friend-profile', 'alice'], cached)
    let respond!: () => void
    const fallback = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation((path: string, options?: { method?: string }) => path === '/api/profiles/alice'
      ? new Promise((resolve) => { respond = () => resolve(structuredClone(detail)) })
      : fallback(path, options))
    mount()

    await screen.findByRole('heading', { name: 'Alice' })
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/api/profiles/alice'))
    expect(screen.queryByRole('img', { name: /Usage visible/ })).toBeNull()
    expect(screen.queryByText(/^Joined /)).toBeNull()
    expect(screen.queryByText("Alice hasn't shared their usage with you.")).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Top models' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Compare with friends' })).toBeNull()
    expect(usageRequests()).toEqual([])

    respond()

    await screen.findByRole('heading', { name: 'Top models' })
    expect(screen.getByRole('img', { name: 'Usage visible to their friends' })).toBeTruthy()
    expect(screen.queryByText("Alice hasn't shared their usage with you.")).toBeNull()
    expect(screen.getByRole('link', { name: 'Compare with friends' })).toBeTruthy()
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

describe("someone else's profile breadcrumb", () => {
  it('leads back to Friends by default and names the person as the current page, by handle until they load', async () => {
    let respond!: () => void
    const fallback = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation((path: string, options?: { method?: string }) => path === '/api/profiles/alice'
      ? new Promise((resolve) => { respond = () => resolve(structuredClone(detail)) })
      : fallback(path, options))
    mount()

    const back = breadcrumb().getByRole('link', { name: 'Friends' })
    expect(back.getAttribute('href')).toBe('/friends')
    // Phones show where you came from, not just an arrow.
    expect(back.textContent).toBe('Friends')
    expect(back.querySelector('.sr-only')).toBeNull()
    expect(breadcrumb().getByText('@alice').getAttribute('aria-current')).toBe('page')

    respond()
    const current = await breadcrumb().findByText('Alice')
    expect(current.getAttribute('aria-current')).toBe('page')
    // The profile heading right below names them on phones.
    expect(current.closest('li')!.className).toContain('max-sm:hidden')
    expect(breadcrumb().getAllByRole('listitem')).toHaveLength(2)
  })

  it('leads back to the leaderboard it was opened from, keeping its scope', async () => {
    mount('/alice', { peopleOrigin: '/friends/leaderboard?scope=pool' })

    await screen.findByRole('heading', { name: 'Alice' })
    expect(breadcrumb().getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/friends/leaderboard?scope=pool')
    expect(breadcrumb().queryByRole('link', { name: 'Friends' })).toBeNull()
  })

  it.each([
    { peopleOrigin: '/billing' }, { peopleOrigin: 'https://example.com/friends' }, { peopleOrigin: ['/friends/leaderboard'] }, '/friends/leaderboard',
  ])('falls back to Friends for untrusted history state %j', async (state) => {
    mount('/alice', state)

    await screen.findByRole('heading', { name: 'Alice' })
    expect(breadcrumb().getByRole('link', { name: 'Friends' }).getAttribute('href')).toBe('/friends')
  })

  it('passes its origin on to mutual friends, so their profile leads back to the same tab', async () => {
    mount('/alice', { peopleOrigin: '/friends/leaderboard?scope=pool' })

    fireEvent.click(await screen.findByRole('link', { name: 'Bob' }))

    expect(location.pathname).toBe('/bob')
    expect(location.state).toEqual({ peopleOrigin: '/friends/leaderboard?scope=pool' })
    expect(await breadcrumb().findByText('Bob')).toBeTruthy()
    expect(breadcrumb().getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/friends/leaderboard?scope=pool')
  })

  it('keeps its origin when moving to the canonical handle', async () => {
    mount('/Alice', { peopleOrigin: '/friends/leaderboard' })

    await waitFor(() => expect(location.pathname).toBe('/alice'))
    expect(location.state).toEqual({ peopleOrigin: '/friends/leaderboard' })
    expect(breadcrumb().getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/friends/leaderboard')
  })
})

describe('own profile', () => {
  it('shows the former usage page with the avatar beside the name', async () => {
    const { container } = mount('/morgan')

    const name = await screen.findByRole('heading', { name: 'Morgan Viewer' })
    const avatar = container.querySelector('[data-slot="avatar"]')!
    expect(avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(avatar.className).toContain('rounded-full')
    expect(screen.getByText('@morgan')).toBeTruthy()
    expect(screen.getByText(/morgan@example\.com · Joined/)).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()

    await screen.findByRole('heading', { name: 'Top models' })
    expect(screen.getByText('Balance (pooled)').nextElementSibling?.textContent).toBe('$12.34')
    expect(within(screen.getByRole('region', { name: 'Recent usage' })).getByRole('columnheader', { name: 'Balance after' })).toBeTruthy()
    expect(usageRequests().some((path) => path.startsWith('/api/usage/activity?'))).toBe(true)
    expect(usageRequests().some((path) => path.startsWith('/api/usage/records?'))).toBe(true)
    expect(mocks.request).not.toHaveBeenCalledWith('/api/profiles/morgan')
    expect(screen.queryByText('Mutual friends')).toBeNull()
  })

  it("sits under Usage's header as its Profile tab, with the leaderboard as a tab instead of a link", async () => {
    mocks.pendingFriendRequests = 1
    mount('/morgan')

    expect(screen.getByRole('heading', { level: 1, name: 'Usage' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: 'Profile' })).toBeNull()
    const tabs = within(screen.getByRole('navigation', { name: 'Usage sections' }))
    const profile = tabs.getByRole('link', { name: 'Profile' })
    expect(profile.getAttribute('href')).toBe('/morgan')
    expect(profile.getAttribute('aria-current')).toBe('page')
    expect(tabs.getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/friends/leaderboard')
    expect((await tabs.findByRole('link', { name: 'Friends, 1 pending' })).getAttribute('aria-current')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Compare with friends' })).toBeNull()
    await screen.findByRole('heading', { name: 'Top models' })
  })

  it('shows who can see your usage as an icon after your handle, on hover', async () => {
    useAuth.setState((state) => ({ user: state.user && { ...state.user, usageVisibility: 'public' } }))
    mount('/morgan')

    const icon = await screen.findByRole('button', { name: 'Usage visible to everyone' })
    const handle = screen.getByText('@morgan')
    expect(icon.parentElement).toBe(handle.parentElement)
    expect(handle.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(icon.textContent).toBe('')
    expect(screen.queryByText('Usage visible to everyone')).toBeNull()

    fireEvent.focus(icon)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toContain('Usage visible to everyone')

    fireEvent.click(icon)
    expect(mocks.openSettings).toHaveBeenCalledWith('profile')
  })

  it('follows a rename to the new handle without ever showing the old one as someone else', async () => {
    mount('/morgan')
    await screen.findByRole('heading', { name: 'Top models' })
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    const sawOtherProfile = vi.fn()
    const observer = new MutationObserver(() => {
      if (screen.queryByText('Loading profile…') || screen.queryByRole('navigation', { name: 'Breadcrumb' })) sawOtherProfile()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    useAuth.setState((state) => ({ user: state.user && { ...state.user, username: 'morgan2' } }))

    await waitFor(() => expect(location.pathname).toBe('/morgan2'))
    observer.disconnect()
    expect(sawOtherProfile).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/profiles\//))
    expect(screen.getByRole('button', { name: '7d' }).className).toContain('bg-accent')
    expect(screen.getByRole('button', { name: '30d' }).className).not.toContain('bg-accent')
  })

  it('moves a non-canonical own handle to the canonical URL', async () => {
    mount('/Morgan')
    await screen.findByRole('heading', { name: 'Morgan Viewer' })
    await waitFor(() => expect(location.pathname).toBe('/morgan'))
    expect(mocks.request).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/profiles\//))
  })
})
