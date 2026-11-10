// @vitest-environment jsdom
import { cloneElement, type ComponentProps, type ReactElement } from 'react'
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
  return { request: vi.fn() }
})
vi.mock('@/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
// Draw the ranking at a fixed size, since jsdom can't measure a responsive container, and without animating its bars in.
vi.mock('recharts', async (importOriginal) => {
  const recharts = await importOriginal<typeof import('recharts')>()
  return {
    ...recharts,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 260 }),
    Bar: (props: ComponentProps<typeof recharts.Bar>) => <recharts.Bar {...props} isAnimationActive={false} />,
  }
})
const { useAuth } = await import('@/stores/auth')
const { LeaderboardPage } = await import('./LeaderboardPage')

const row = { userId: 'friend-1', displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null, calls: 2, tokens: 30, costMicros: 1_000 }
const ownRow = { ...row, userId: 'me', displayName: 'Me Myself', username: 'me', calls: 1, tokens: 10 }
const record = {
  id: 'usage-1', createdAt: '2026-09-20T00:00:00Z',
  participant: { id: 'friend-1', displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null },
  model: { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', logo: 'zhipu' },
  inputTokens: 20, outputTokens: 10, costMicros: 1_000, inferenceReferenceCostMicros: 0, subscriptionCoveredMicros: 0, costBreakdown: null,
}
let location: ReturnType<typeof useLocation>
function LocationProbe() {
  location = useLocation()
  return null
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'me', username: 'me' } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
  mocks.request.mockImplementation(async (path: string) => {
    if (path.includes('/records?')) return { data: [record], nextCursor: null }
    if (path.includes('/activity?')) return { summary: { calls: 2, inputTokens: 20, outputTokens: 10, costMicros: 1_000, firstUsedAt: null }, daily: [], contribution: [], topModels: [] }
    return { data: path.startsWith('/api/admin/') ? [{ ...row, balanceMicros: 5_000_000 }, { ...ownRow, balanceMicros: 0 }] : [row, ownRow] }
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

function mount(scope: 'friends' | 'pool' | 'instance', path = '/friends/leaderboard') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><TooltipProvider>
    <LeaderboardPage scope={scope} />
    <LocationProbe />
  </TooltipProvider></MemoryRouter></QueryClientProvider>)
}

const bar = async (container: HTMLElement, index: number) => {
  await waitFor(() => expect(container.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(2))
  return container.querySelectorAll('.recharts-bar-rectangle path')[index]!
}
// jsdom has no PointerEvent, so the plain event it falls back to needs its pointer type set by hand.
const pointerDown = (target: Element, pointerType: string) => {
  const event = createEvent.pointerDown(target)
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  fireEvent(target, event)
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

it("links each ranked name, bar, and recent request to the person's profile, keeping the leaderboard as its origin", async () => {
  const { container } = mount('pool', '/friends/leaderboard?scope=pool')
  await screen.findByText('Pool ranking')
  const origin = { peopleOrigin: '/friends/leaderboard?scope=pool' }

  const axis = await waitFor(() => container.querySelector<HTMLElement>('.recharts-xAxis-tick-labels')!)
  const alice = within(axis).getByRole('link', { name: 'Alice' })
  expect(alice.getAttribute('href')).toBe('/alice')
  expect(alice.textContent).toBe('Alice')
  // Your own name and bar lead to your own profile.
  expect(within(axis).getByRole('link', { name: 'Me Myself' }).getAttribute('href')).toBe('/me')
  fireEvent.click(alice)
  expect(location.pathname).toBe('/alice')
  expect(location.state).toEqual(origin)

  cleanup()
  const second = mount('pool', '/friends/leaderboard?scope=pool')
  await screen.findByText('Pool ranking')
  const ownBar = await bar(second.container, 1)
  expect(ownBar.getAttribute('cursor')).toBe('pointer')
  fireEvent.click(ownBar)
  expect(location.pathname).toBe('/me')
  expect(location.state).toEqual(origin)

  cleanup()
  mount('pool', '/friends/leaderboard?scope=pool')
  const participant = within(await screen.findByRole('region', { name: 'Recent usage' })).getByRole('link', { name: 'Alice' })
  expect(participant.getAttribute('href')).toBe('/alice')
  fireEvent.click(participant)
  expect(location.pathname).toBe('/alice')
  expect(location.state).toEqual(origin)
})

it("keeps a tap on a bar for its tooltip and opens the profile only from a mouse click", async () => {
  const { container } = mount('pool', '/friends/leaderboard?scope=pool')
  await screen.findByText('Pool ranking')
  const ownBar = await bar(container, 1)
  pointerDown(ownBar, 'touch')
  fireEvent.click(ownBar)
  expect(location.pathname).toBe('/friends/leaderboard')
  pointerDown(ownBar, 'mouse')
  fireEvent.click(ownBar)
  expect(location.pathname).toBe('/me')
  expect(location.state).toEqual({ peopleOrigin: '/friends/leaderboard?scope=pool' })
})

it('shortens and rotates linked axis names like the plain instance labels once more than eight people rank', async () => {
  // jsdom has no canvas, so label widths fall back to an estimate.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const long = 'Bartholomew Montgomery-Fitzwilliam'
  const people = Array.from({ length: 9 }, (_, i) => ({ ...row, userId: `u${i}`, username: `u${i}`, displayName: i === 0 ? long : `P${i}`, calls: 100 - i, balanceMicros: 0 }))
  mocks.request.mockImplementation(async (path: string) => {
    if (path.includes('/records?')) return { data: [], nextCursor: null }
    if (path.includes('/activity?')) return { summary: { calls: 2, inputTokens: 20, outputTokens: 10, costMicros: 1_000, firstUsedAt: null }, daily: [], contribution: [], topModels: [] }
    return { data: people }
  })
  const tick = async (container: HTMLElement) => {
    const axis = await waitFor(() => container.querySelector<HTMLElement>('.recharts-xAxis-tick-labels')!)
    const text = [...axis.querySelectorAll('text')].find((el) => el.textContent?.startsWith('Bartholomew'))!
    return { axis, markup: { text: text.textContent, transform: text.getAttribute('transform'), anchor: text.getAttribute('text-anchor') } }
  }
  const linked = mount('friends')
  await screen.findByText('Friends ranking')
  const { axis, markup } = await tick(linked.container)
  // The link keeps the full name for screen readers; the drawn label is shortened and angled.
  expect(within(axis).getByRole('link', { name: long })).toBeTruthy()
  expect(markup.text).toBe('Bartholomew Montgom…')
  expect(markup.transform).toMatch(/^rotate\(-35,/)
  expect(markup.anchor).toBe('end')
  cleanup()
  const plain = mount('instance', '/admin/usage')
  await screen.findByText('Instance ranking')
  expect(markup).toEqual((await tick(plain.container)).markup)
})

it('leaves the admin instance ranking unlinked', async () => {
  const { container } = mount('instance', '/admin/usage')
  await screen.findByText('Instance ranking')
  const axis = await waitFor(() => container.querySelector<HTMLElement>('.recharts-xAxis-tick-labels')!)
  expect(within(axis).getByText('Alice')).toBeTruthy()
  expect(within(axis).queryByRole('link')).toBeNull()
  const aliceBar = await bar(container, 0)
  expect(aliceBar.getAttribute('cursor')).toBeNull()
  fireEvent.click(aliceBar)
  expect(location.pathname).toBe('/admin/usage')
  const records = await screen.findByRole('region', { name: 'Recent usage' })
  expect(within(records).getByText('Alice')).toBeTruthy()
  expect(within(records).queryByRole('link')).toBeNull()
})

it('keeps people who share a display name apart in the ranking', async () => {
  const twins = [
    { ...row, userId: 'sam-1', username: 'sam', displayName: 'Sam', calls: 300 },
    { ...row, userId: 'sam-2', username: 'sam2', displayName: 'Sam', calls: 100 },
  ]
  mocks.request.mockImplementation(async (path: string) => {
    if (path.includes('/records?')) return { data: [], nextCursor: null }
    if (path.includes('/activity?')) return { summary: { calls: 2, inputTokens: 20, outputTokens: 10, costMicros: 1_000, firstUsedAt: null }, daily: [], contribution: [], topModels: [] }
    return { data: twins }
  })
  const { container } = mount('friends')
  await screen.findByText('Friends ranking')
  const axis = await waitFor(() => container.querySelector<HTMLElement>('.recharts-xAxis-tick-labels')!)
  expect([...axis.querySelectorAll('text')].map((el) => el.textContent)).toEqual(['Sam', 'Sam'])
  // Each name links to its own person, and screen readers hear which Sam is which.
  expect(within(axis).getByRole('link', { name: 'Sam (@sam)' }).getAttribute('href')).toBe('/sam')
  expect(within(axis).getByRole('link', { name: 'Sam (@sam2)' }).getAttribute('href')).toBe('/sam2')

  // Stepping through the ranking describes each Sam, not the first one found by name.
  const chart = container.querySelector<HTMLElement>('.recharts-wrapper')!
  fireEvent.focusIn(chart)
  const tip = () => container.querySelector<HTMLElement>('.recharts-tooltip-wrapper')?.textContent
  await waitFor(() => expect(tip()).toBe('#1 Sam (@sam)Calls300'))
  fireEvent.keyDown(chart, { key: 'ArrowRight' })
  await waitFor(() => expect(tip()).toBe('#2 Sam (@sam2)Calls100'))
})
