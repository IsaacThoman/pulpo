// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Chat, Folder } from '@/lib/types'

const actions = vi.hoisted(() => ({
  reorderLooseChats: vi.fn(),
  reorderPinnedChats: vi.fn(),
  reorderFolderChats: vi.fn(),
  reorderFolders: vi.fn(),
  moveToFolder: vi.fn(),
  toggleFolder: vi.fn(),
}))

vi.mock('@/stores/chat', () => {
  const chat = (id: string, sortOrder: number, patch: Partial<Chat> = {}): Chat => ({
    id, title: `Chat ${id}`, modelId: 'model', messages: [], createdAt: 0, updatedAt: 0, pinned: false,
    folderId: null, sortOrder, tags: [], temporary: false, expiresAt: null, expired: false, ...patch,
  })
  const folder = (id: string, sortOrder: number): Folder => ({ id, name: `Folder ${id}`, pinned: false, expanded: true, sortOrder })
  const state = {
    chats: [
      chat('p1', 0, { pinned: true }), chat('p2', 1, { pinned: true }),
      chat('x1', 0, { folderId: 'f1' }), chat('x2', 1, { folderId: 'f1' }),
      chat('a', 0), chat('b', 1), chat('c', 2),
    ],
    folders: [folder('f1', 0), folder('f2', 1)],
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

const ROW_HEIGHT = 30

/**
 * jsdom has no layout, so stack every reorderable row 30px apart in document order:
 * p1 0, p2 30, f1 60, x1 90, x2 120, f2 150, a 180, b 210, c 240. Other elements span their rows.
 */
function layOutRows() {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rows = Array.from(document.querySelectorAll('[data-drag-list]'))
    const inside = rows.filter((row) => this === row || this.contains(row))
    if (inside.length === 0) return original.call(this)
    const top = rows.indexOf(inside[0]!) * ROW_HEIGHT
    const height = inside.length * ROW_HEIGHT
    return { top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }
  return () => { Element.prototype.getBoundingClientRect = original }
}

function dataTransfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
}

function mount() {
  render(<QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter>
        <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>)
}

const chatRow = (id: string) => screen.getByRole('link', { name: `Chat ${id}` }).parentElement!
const folderRow = (id: string) => document.querySelector(`[data-drag-list="folder"][data-drag-id="${id}"]`)!

/** Drag `source` and release it at `clientY` over `target` (default: empty sidebar space no row claims). */
function dragTo(source: Element, clientY: number, target: Element = document.querySelector('aside .overflow-y-auto')!) {
  const transfer = dataTransfer()
  fireEvent.dragStart(source, { dataTransfer: transfer })
  for (const type of ['dragOver', 'drop'] as const) {
    const event = createEvent[type](target, { dataTransfer: transfer })
    Object.defineProperty(event, 'clientY', { value: clientY })
    fireEvent(target, event)
  }
}

let restoreLayout: () => void
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  restoreLayout = layOutRows()
  mount()
})
afterEach(() => {
  cleanup()
  restoreLayout()
  vi.clearAllMocks()
})

describe('sidebar chat dragging outside the rows', () => {
  it('moves an unfiled chat to the end when dropped below the list', () => {
    dragTo(chatRow('a'), 10_000)
    expect(actions.reorderLooseChats).toHaveBeenCalledWith('a', 'c', 'after')
  })

  it('moves an unfiled chat to the top when dragged above the list', () => {
    dragTo(chatRow('c'), 5)
    expect(actions.reorderLooseChats).toHaveBeenCalledWith('c', 'a', 'before')
  })

  it('reorders pinned chats from the header or the gaps between them', () => {
    dragTo(chatRow('p2'), -10)
    expect(actions.reorderPinnedChats).toHaveBeenCalledWith('p2', 'p1', 'before')
  })

  it('reorders a chat within its folder from the folder header', () => {
    dragTo(chatRow('x2'), 70)
    expect(actions.reorderFolderChats).toHaveBeenCalledWith('f1', 'x2', 'x1', 'before')
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })

  it('moves a folder chat into the unfiled list when dragged down there', () => {
    dragTo(chatRow('x1'), 10_000)
    expect(actions.moveToFolder).toHaveBeenCalledWith('x1', null, { targetId: 'c', edge: 'after' })
  })

  it('reorders folders from outside the folder rows', () => {
    dragTo(folderRow('f2'), 0)
    expect(actions.reorderFolders).toHaveBeenCalledWith('f2', 'f1', 'before')
  })

  it('still drops directly on rows and folder headers', () => {
    dragTo(chatRow('a'), 245, chatRow('c'))
    expect(actions.reorderLooseChats).toHaveBeenCalledWith('a', 'c', 'before')
    dragTo(chatRow('b'), 150, folderRow('f2'))
    expect(actions.moveToFolder).toHaveBeenCalledWith('b', 'f2')
  })

  it('leaves a chat in place when released next to where it started', () => {
    dragTo(chatRow('b'), 215)
    expect(actions.reorderLooseChats).not.toHaveBeenCalled()
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })
})
