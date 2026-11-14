// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEFAULT_SIDEBAR_PINS } from '@/lib/sidebar-pins'

const mocks = vi.hoisted(() => ({
  openBillingPortal: vi.fn(async () => {}),
  fetchBillingSummary: vi.fn(async () => ({ plan: 'baby', onHold: false, subscription: null as object | null })),
  abandonTemporaryChat: vi.fn(),
  pendingFriendRequests: 0,
}))

vi.mock('@/stores/chat', () => {
  const state = {
    chats: [],
    folders: [],
    streamingIds: [] as string[],
    responseChatIds: {} as Record<string, string>,
    activeTemporaryChatId: null,
    composerModelId: 'model',
    abandonTemporaryChat: mocks.abandonTemporaryChat,
  }
  return {
    compareChatOrder: () => 0,
    useChat: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }),
  }
})
vi.mock('@/stores/auth', () => {
  const state = {
    user: { id: 'u1', name: 'Octo', username: 'octo', role: 'user' },
    instanceReady: true, apiKeysEnabled: true, billingEnabled: true, filesEnabled: false,
    logout: vi.fn(), signOutActiveAccount: vi.fn(),
  }
  return { useAuth: (select: (value: typeof state) => unknown) => select(state) }
})
const settings = vi.hoisted(() => ({
  sidebarPins: {} as Record<string, boolean>, set: vi.fn(), trashRetention: '30d', automaticChatExpiration: 'disabled',
  composerSyncEnabled: false, chatSortMode: 'default',
}))
vi.mock('@/stores/settings', () => ({
  useSettings: Object.assign((select: (value: typeof settings) => unknown) => select(settings), {
    getState: () => settings,
    subscribe: () => () => undefined,
  }),
}))
vi.mock('@/lib/api', () => ({
  apiRequest: async (path: string) => ({ count: path === '/api/friends/pending-count' ? mocks.pendingFriendRequests : 0 }),
}))
vi.mock('@/lib/billing', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/billing')>(),
  fetchBillingSummary: mocks.fetchBillingSummary,
  openBillingPortal: mocks.openBillingPortal,
}))
vi.mock('@/components/layout/AccountSwitcher', () => ({ AccountSwitcherMenuItems: () => null }))

const { Sidebar } = await import('./Sidebar')

let location: ReturnType<typeof useLocation>
function LocationProbe() {
  location = useLocation()
  return null
}

function mount(path = '/octo') {
  render(<QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={onOpenSearch} onOpenSettings={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>)
}

const onOpenSearch = vi.fn()
// Pages are links in the primary nav; New chat and Search are actions.
const navButton = (name: string) => screen.queryByRole('button', { name }) ?? screen.getByRole('link', { name })
const openMenu = async (name: string) => {
  fireEvent.contextMenu(navButton(name), { clientX: 20, clientY: 40 })
  await screen.findByRole('menu')
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())
}
const choose = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }))

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  // A pin saved before Usage left the sidebar stays on and must not bring it back.
  settings.sidebarPins = { ...DEFAULT_SIDEBAR_PINS, searchChats: true, usage: true, billing: true, friends: true, apiKeys: true }
  mocks.pendingFriendRequests = 0
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sidebar nav button menus', () => {
  it('starts a new chat, or a temporary one', async () => {
    mount()
    expect(await openMenu('New chat')).toEqual(['New chat', 'New temporary chat'])
    choose('New temporary chat')
    expect(mocks.abandonTemporaryChat).toHaveBeenCalled()
    expect(location.pathname).toBe('/')
    expect(location.state).toMatchObject({ temporary: true })

    await openMenu('New chat')
    choose('New chat')
    expect((location.state as { temporary?: boolean }).temporary).toBeUndefined()
  })

  it('searches, and unpins the button', async () => {
    mount()
    expect(await openMenu('Search')).toEqual(['Search', 'Unpin'])
    choose('Search')
    expect(onOpenSearch).toHaveBeenCalled()

    await openMenu('Search')
    choose('Unpin')
    expect(settings.set).toHaveBeenCalledWith('sidebarPins', expect.objectContaining({ searchChats: false, friends: true }))
  })

  it('offers billing from Billing, with the portal only for a subscription', async () => {
    mount()
    expect(await openMenu('Billing')).toEqual(['Manage billing', 'Add credits', 'Unpin'])
    choose('Add credits')
    expect(`${location.pathname}${location.search}`).toBe('/billing?topup=1')

    cleanup()
    const subscribed = Promise.resolve({ plan: 'baby', onHold: false, subscription: {} })
    mocks.fetchBillingSummary.mockReturnValueOnce(subscribed)
    mount()
    await act(() => subscribed)
    expect(await openMenu('Billing')).toEqual(['Manage billing', 'Add credits', 'Billing portal', 'Unpin'])
    choose('Billing portal')
    expect(mocks.openBillingPortal).toHaveBeenCalled()
  })

  it('opens your profile or friends from Usage, and copies the handle', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mount()
    expect(await openMenu('Usage')).toEqual(['Your profile', 'View friends', 'Copy handle', 'Unpin'])
    choose('Copy handle')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('octo'))

    await openMenu('Usage')
    choose('View friends')
    expect(location.pathname).toBe('/friends')

    await openMenu('Usage')
    choose('Your profile')
    expect(location.pathname).toBe('/octo')

    await openMenu('Usage')
    choose('Unpin')
    expect(settings.set).toHaveBeenCalledWith('sidebarPins', expect.objectContaining({ friends: false }))
  })

  it('opens API keys, or starts a new key', async () => {
    mount()
    expect(await openMenu('API keys')).toEqual(['View keys', 'New key', 'Unpin'])
    choose('New key')
    expect(`${location.pathname}${location.search}`).toBe('/api-keys?new=1')
  })

  it('marks the open page in a labeled primary nav', () => {
    mount('/billing')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const billing = screen.getByRole('link', { name: 'Billing' })
    expect(nav.contains(billing)).toBe(true)
    expect(billing.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Usage' }).getAttribute('aria-current')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'API keys' }))
    expect(location.pathname).toBe('/api-keys')
  })

  it('shows one Usage item, even with the old Usage pin saved', async () => {
    mount()
    expect(screen.getAllByRole('link', { name: 'Usage' })).toHaveLength(1)
    fireEvent.contextMenu(screen.getByRole('button', { name: /Octo/ }))
    await screen.findByRole('menuitem', { name: 'Settings' })
    expect(screen.getAllByRole('menuitem', { name: 'Usage' })).toHaveLength(1)
  })

  // Someone else's profile is a drill-down inside Usage, so Usage stays current there too.
  it.each(['/octo', '/Octo', '/friends', '/friends/leaderboard', '/jordan', '/Jordan'])('opens your profile from Usage and keeps it current on %s', (path) => {
    mount(path)
    const usage = screen.getByRole('link', { name: 'Usage' })
    expect(usage.getAttribute('href')).toBe('/octo')
    expect(usage.getAttribute('aria-current')).toBe('page')
  })

  it.each(['/', '/files', '/Files', '/api-keys', '/usage', '/admin/users', '/c/chat-1'])("doesn't mark Usage current on %s", (path) => {
    mount(path)
    expect(screen.getByRole('link', { name: 'Usage' }).getAttribute('aria-current')).toBeNull()
  })

  it('announces pending friend requests on Usage', async () => {
    mocks.pendingFriendRequests = 2
    mount()
    const usage = await screen.findByRole('link', { name: 'Usage, 2 pending' })
    expect(usage.textContent).toContain('2')
    fireEvent.contextMenu(screen.getByRole('button', { name: /Octo/ }))
    expect((await screen.findByRole('menuitem', { name: /^Usage/ })).textContent).toBe('Usage2')
  })

  it.each([
    { pinned: true, key: 'Enter', label: 'Unpin Usage from sidebar' },
    { pinned: false, key: ' ', label: 'Pin Usage to sidebar' },
  ])('lets the keyboard activate "$label" with $key without leaving the menu', async ({ pinned, key, label }) => {
    settings.sidebarPins.friends = pinned
    mount()
    const account = screen.getByRole('button', { name: /Octo/ })
    fireEvent.keyDown(account, { key: 'ArrowDown' })
    const search = await screen.findByRole('menuitem', { name: 'Search' })
    await waitFor(() => expect(document.activeElement).toBe(search))
    const searchPin = screen.getByRole('menuitem', { name: 'Unpin Search from sidebar' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(searchPin))
    fireEvent.keyDown(searchPin, { key: 'ArrowDown' })
    const usage = screen.getByRole('menuitem', { name: 'Usage' })
    await waitFor(() => expect(document.activeElement).toBe(usage))
    const pin = screen.getByRole('menuitem', { name: label })
    fireEvent.keyDown(usage, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(pin))
    fireEvent.keyDown(pin, { key })
    expect(settings.set).toHaveBeenCalledExactlyOnceWith('sidebarPins', expect.objectContaining({ friends: !pinned }))
    expect(document.activeElement).toBe(pin)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(location.pathname).toBe('/octo')
    expect(onOpenSearch).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Show in sidebar' })).toBeNull()

    fireEvent.keyDown(pin, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(account))
  })

  it('keeps the pin click separate from opening the page', async () => {
    mount()
    fireEvent.contextMenu(screen.getByRole('button', { name: /Octo/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin Billing from sidebar' }))
    expect(settings.set).toHaveBeenCalledExactlyOnceWith('sidebarPins', expect.objectContaining({ billing: false }))
    expect(location.pathname).toBe('/octo')
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Billing' }))
    expect(location.pathname).toBe('/billing')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens the account menu on right-click, as on click', async () => {
    mount()
    fireEvent.contextMenu(screen.getByRole('button', { name: /Octo/ }))
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeTruthy()
  })
})
