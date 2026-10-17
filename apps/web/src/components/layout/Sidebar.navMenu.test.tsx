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
vi.mock('@/lib/api', () => ({ apiRequest: async () => ({ count: 0 }) }))
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

function mount() {
  render(<QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter initialEntries={['/usage']}>
        <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={onOpenSearch} onOpenSettings={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>)
}

const onOpenSearch = vi.fn()
const navButton = (name: string) => screen.getByRole('button', { name })
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
  settings.sidebarPins = { ...DEFAULT_SIDEBAR_PINS, searchChats: true, usage: true, billing: true, friends: true, apiKeys: true }
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
    expect(settings.set).toHaveBeenCalledWith('sidebarPins', expect.objectContaining({ searchChats: false, usage: true }))
  })

  it('offers billing from Usage and Billing, with the portal only for a subscription', async () => {
    mount()
    expect(await openMenu('Usage')).toEqual(['Manage billing', 'Add credits', 'Unpin'])
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

  it('opens friends and copies the handle', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mount()
    expect(await openMenu('Friends')).toEqual(['View friends', 'Copy handle', 'Unpin'])
    choose('Copy handle')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('octo'))

    await openMenu('Friends')
    choose('View friends')
    expect(location.pathname).toBe('/friends')
  })

  it('opens API keys, or starts a new key', async () => {
    mount()
    expect(await openMenu('API keys')).toEqual(['View keys', 'New key', 'Unpin'])
    choose('New key')
    expect(`${location.pathname}${location.search}`).toBe('/api-keys?new=1')
  })

  it('opens the account menu on right-click, as on click', async () => {
    mount()
    fireEvent.contextMenu(screen.getByRole('button', { name: /Octo/ }))
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeTruthy()
  })
})
