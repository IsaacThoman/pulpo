// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Chat } from '@/lib/types'

const store = vi.hoisted(() => ({ useChat: null as unknown as typeof import('@/stores/chat').useChat }))

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  const chat = (id: string, title: string, pinned = false): Chat => ({
    id, title, modelId: 'model', messages: [], createdAt: 0, updatedAt: 0, pinned,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false,
  })
  const useChat = create(() => ({
    chats: [chat('a', 'Lisbon trip'), chat('b', 'Octopus facts'), chat('p', 'Pinned plan', true)],
    folders: [],
    streamingIds: [] as string[],
    responseChatIds: {} as Record<string, string>,
    activeTemporaryChatId: null,
    composerModelId: 'model',
  }))
  store.useChat = useChat as never
  return {
    compareChatOrder: (a: Chat, b: Chat) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt,
    useChat,
  }
})
vi.mock('@/stores/auth', () => {
  const state = { user: null, instanceReady: true, apiKeysEnabled: false, billingEnabled: false, logout: vi.fn() }
  return { useAuth: (select: (value: typeof state) => unknown) => select(state) }
})
vi.mock('@/stores/settings', () => {
  const state = {
    sidebarPins: {}, set: vi.fn(), trashRetention: '30d', automaticChatExpiration: '1d', composerSyncEnabled: false,
  }
  return {
    useSettings: Object.assign((select: (value: typeof state) => unknown) => select(state), {
      getState: () => state,
      subscribe: () => () => undefined,
    }),
  }
})

const { Sidebar } = await import('./Sidebar')

function mount(collapsed = false, path = '/c/a') {
  return render(<QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <SidebarAt collapsed={collapsed} />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>)
}

// The sidebar reads the open chat from the route, as in the app.
const { Route, Routes } = await import('react-router-dom')
function SidebarAt({ collapsed }: { collapsed: boolean }) {
  const sidebar = <Sidebar collapsed={collapsed} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={vi.fn()} onOpenSettings={vi.fn()} />
  return <Routes><Route path="/c/:chatId" element={sidebar} /><Route path="*" element={sidebar} /></Routes>
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(cleanup)

describe('sidebar accessibility', () => {
  it('names each row menu after its row and marks the open chat as the current page', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Options for Lisbon trip' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Options for Octopus facts' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Lisbon trip' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Octopus facts' }).getAttribute('aria-current')).toBeNull()
  })

  it('keeps row menus in the tab order, shown on keyboard focus as on hover', () => {
    mount()
    const options = screen.getByRole('button', { name: 'Options for Octopus facts' })
    expect(options.tabIndex).toBe(0)
    expect(options.className).not.toMatch(/(^|\s)invisible(\s|$)/)
    expect(options.className).toContain('group-hover:opacity-100')
    expect(options.className).toContain('group-has-[:focus-visible]:opacity-100')
  })

  it('lists chats in labeled lists, pinned ones apart', () => {
    mount()
    const pinned = screen.getByRole('list', { name: 'Pinned' })
    expect(within(pinned).getByRole('link', { name: 'Pinned plan' })).toBeTruthy()
    const chats = screen.getByRole('list', { name: 'Chats' })
    expect(within(chats).getAllByRole('listitem')).toHaveLength(2)
  })

  it('takes the hidden chat list out of the tab order while collapsed', () => {
    const view = mount(true)
    const link = view.container.querySelector<HTMLAnchorElement>('a[href="/c/b"]')!
    expect(link.closest('[inert]')).not.toBeNull()
    expect(link.closest('[aria-hidden="true"]')).not.toBeNull()
    cleanup()
    const open = mount(false)
    expect(open.container.querySelector('a[href="/c/b"]')!.closest('[inert]')).toBeNull()
  })

  it('describes a chat that is generating or set to expire', () => {
    mount()
    const link = screen.getByRole('link', { name: 'Octopus facts' })
    expect(link.getAttribute('aria-describedby')).toBeNull()
    act(() => {
      store.useChat.setState((state) => ({ chats: state.chats.map((chat) => chat.id === 'b' ? { ...chat, expiresAt: Date.now() + 60_000 } : chat) }))
    })
    const described = screen.getByRole('link', { name: 'Octopus facts' })
    expect(document.getElementById(described.getAttribute('aria-describedby')!)?.textContent).toBe('Set to expire')
    act(() => {
      store.useChat.setState({ streamingIds: ['r1'], responseChatIds: { r1: 'a' } })
    })
    const generating = screen.getByRole('link', { name: 'Lisbon trip' })
    expect(document.getElementById(generating.getAttribute('aria-describedby')!)?.textContent).toBe('Generating…')
  })
})
