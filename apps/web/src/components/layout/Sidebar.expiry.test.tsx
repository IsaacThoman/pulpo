// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Chat } from '@/lib/types'

const store = vi.hoisted(() => ({ useChat: null as unknown as typeof import('@/stores/chat').useChat }))

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  const chat: Chat = {
    id: 'a', title: 'Chat a', modelId: 'model', messages: [], createdAt: 0, updatedAt: 0, pinned: false,
    folderId: null, sortOrder: 0, tags: [], temporary: false, expiresAt: null, expired: false,
  }
  const useChat = create(() => ({
    chats: [chat],
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

const setExpiresAt = (expiresAt: number | null) => act(() => {
  store.useChat.setState((state) => ({ chats: state.chats.map((chat) => ({ ...chat, expiresAt })) }))
})
const optionsButton = () => screen.getByRole('link', { name: 'Chat a' }).parentElement!.querySelector('button[aria-haspopup]')!

afterEach(cleanup)

describe('sidebar chat expiry indicator', () => {
  it('follows expiry changes made outside the sidebar', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    })
    render(<QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <MemoryRouter>
          <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={vi.fn()} onOpenSettings={vi.fn()} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>)

    expect(optionsButton().querySelector('.lucide-hourglass')).toBeNull()
    setExpiresAt(Date.now() + 60_000)
    expect(optionsButton().querySelector('.lucide-hourglass')).not.toBeNull()
    setExpiresAt(null)
    expect(optionsButton().querySelector('.lucide-hourglass')).toBeNull()
  })
})
