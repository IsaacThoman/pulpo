// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Chat, Folder } from '@/lib/types'

const actions = vi.hoisted(() => ({
  reorderLooseChats: vi.fn(),
  moveToFolder: vi.fn(),
}))

vi.mock('@/stores/chat', () => {
  const chat = (id: string, sortOrder: number): Chat => ({
    id, title: `Chat ${id}`, modelId: 'model', messages: [], createdAt: 0, updatedAt: 0, pinned: false,
    folderId: null, sortOrder, tags: [], temporary: false, expiresAt: null, expired: false,
  })
  const state = {
    chats: [chat('a', 0), chat('b', 1), chat('c', 2)],
    folders: [] as Folder[],
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
vi.mock('@/stores/settings', () => {
  const state = {
    sidebarPins: {}, set: vi.fn(), trashRetention: '30d', automaticChatExpiration: 'disabled', composerSyncEnabled: false,
  }
  return {
    useSettings: Object.assign((select: (value: typeof state) => unknown) => select(state), {
      getState: () => state,
      subscribe: () => () => undefined,
    }),
  }
})

const { Sidebar } = await import('./Sidebar')

function dataTransfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
}

function dragEvent(type: 'dragOver' | 'drop', target: Element, transfer: ReturnType<typeof dataTransfer>, clientY: number) {
  const event = createEvent[type](target, { dataTransfer: transfer })
  Object.defineProperty(event, 'clientY', { value: clientY })
  fireEvent(target, event)
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sidebar chat dragging', () => {
  it('moves an unfiled chat to the end when dropped below the list', () => {
    render(<QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <MemoryRouter>
          <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={vi.fn()} onOpenSettings={vi.fn()} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>)
    const row = screen.getByRole('link', { name: 'Chat a' }).parentElement!
    const list = row.closest('.overflow-y-auto')!
    const transfer = dataTransfer()

    fireEvent.dragStart(row, { dataTransfer: transfer })
    // The empty sidebar space under the last row sits below the unfiled list.
    dragEvent('dragOver', list, transfer, 10_000)
    dragEvent('drop', list, transfer, 10_000)

    expect(actions.reorderLooseChats).toHaveBeenCalledWith('a', 'c', 'after')
  })
})
