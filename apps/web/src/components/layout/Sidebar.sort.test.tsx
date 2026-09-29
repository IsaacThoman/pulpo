// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Chat } from '@/lib/types'

const DAY = 86_400_000
const now = Date.now()

const actions = vi.hoisted(() => ({
  reorderLooseChats: vi.fn(),
  moveToFolder: vi.fn(),
}))

vi.mock('@/stores/chat', () => {
  const chat = (id: string, sortOrder: number, updatedAt: number): Chat => ({
    id, title: `Chat ${id}`, modelId: 'model', messages: [], createdAt: 0, updatedAt, pinned: false,
    folderId: null, sortOrder, tags: [], temporary: false, expiresAt: null, expired: false,
  })
  const state = {
    // Manual order a, b, c; activity order c (today), a (3 days ago), b (a year ago).
    chats: [chat('a', 0, now - 3 * DAY), chat('b', 1, now - 365 * DAY), chat('c', 2, now)],
    folders: [],
    streamingIds: [] as string[],
    responseChatIds: {} as Record<string, string>,
    activeTemporaryChatId: null,
    composerModelId: 'model',
    ...actions,
  }
  return {
    compareChatOrder: (a: Chat, b: Chat) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt,
    useChat: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }),
  }
})
vi.mock('@/stores/auth', () => {
  const state = { user: null, instanceReady: true, apiKeysEnabled: false, billingEnabled: false, logout: vi.fn() }
  return { useAuth: (select: (value: typeof state) => unknown) => select(state) }
})
const settings = vi.hoisted(() => ({
  sidebarPins: {}, set: vi.fn(), trashRetention: '30d', automaticChatExpiration: 'disabled', composerSyncEnabled: false,
  chatSortMode: 'default' as 'default' | 'recent',
}))
vi.mock('@/stores/settings', () => ({
  useSettings: Object.assign((select: (value: typeof settings) => unknown) => select(settings), {
    getState: () => settings,
    subscribe: () => () => undefined,
  }),
}))

const { Sidebar } = await import('./Sidebar')

function mount() {
  render(<QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter>
        <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>)
}

const rowTitles = () => screen.getAllByRole('link', { name: /^Chat / }).map((link) => link.textContent)

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  settings.chatSortMode = 'default'
})

describe('sidebar chat sort toggle', () => {
  it('keeps the manual order without time headings by default', () => {
    mount()
    expect(rowTitles()).toEqual(['Chat a', 'Chat b', 'Chat c'])
    expect(screen.queryByText('Today')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Chat order: Default/ }))
    expect(settings.set).toHaveBeenCalledWith('chatSortMode', 'recent')
  })

  it('lists recently updated chats first under time headings', () => {
    settings.chatSortMode = 'recent'
    mount()
    expect(rowTitles()).toEqual(['Chat c', 'Chat a', 'Chat b'])
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('Previous 7 Days')).toBeTruthy()
    expect(screen.getByText('Older')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Chat order: Recent/ }))
    expect(settings.set).toHaveBeenCalledWith('chatSortMode', 'default')
  })

  it('does not reorder unfiled chats by dragging in recent order', () => {
    settings.chatSortMode = 'recent'
    mount()
    const source = screen.getByRole('link', { name: 'Chat c' }).parentElement!
    const target = screen.getByRole('link', { name: 'Chat b' }).parentElement!
    const data = new Map<string, string>()
    const dataTransfer = { effectAllowed: 'move', dropEffect: 'move', setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' }
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(target.getAttribute('data-drag-list')).toBeNull()
    expect(actions.reorderLooseChats).not.toHaveBeenCalled()
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })
})
