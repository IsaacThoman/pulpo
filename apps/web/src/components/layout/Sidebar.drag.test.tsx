// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SidebarState } from '@pulpo/contracts'
import type { Chat } from '@/lib/types'

const actions = vi.hoisted(() => ({
  reorderLooseChats: vi.fn(),
  reorderPinnedChats: vi.fn(),
  reorderFolderChats: vi.fn(),
  moveToFolder: vi.fn(),
  pinChat: vi.fn(),
  unpinChat: vi.fn(),
}))

const sidebarActions = vi.hoisted(() => ({
  moveSidebarFolder: vi.fn(),
  addShortcut: vi.fn(),
  reorderShortcuts: vi.fn(),
}))

const sidebarState = vi.hoisted(() => ({
  chatsFolderId: 'chats',
  archiveFolderId: 'archive',
  // f3 sits inside f1.
  folders: [
    { id: 'chats', parentId: null, name: 'Chats', systemRole: 'chats' },
    { id: 'archive', parentId: null, name: 'Archive', systemRole: 'archive' },
    { id: 'f1', parentId: 'chats', name: 'Folder f1', systemRole: null },
    { id: 'f2', parentId: 'chats', name: 'Folder f2', systemRole: null },
    { id: 'f3', parentId: 'f1', name: 'Folder f3', systemRole: null },
  ],
  shortcuts: [],
} as SidebarState))

vi.mock('@/stores/chat', () => {
  const chat = (id: string, sortOrder: number, patch: Partial<Chat> = {}): Chat => ({
    id, title: `Chat ${id}`, modelId: 'model', messages: [], createdAt: 0, updatedAt: 0, pinned: false,
    folderId: null, sortOrder, tags: [], temporary: false, expiresAt: null, expired: false, ...patch,
  })
  const state = {
    chats: [
      chat('p1', 0, { pinned: true }), chat('p2', 1, { pinned: true }),
      chat('x1', 0, { folderId: 'f1' }), chat('x2', 1, { folderId: 'f1' }),
      chat('a', 0), chat('b', 1), chat('c', 2),
    ],
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
  const state = { user: null, instanceReady: true, apiKeysEnabled: false, billingEnabled: false, filesEnabled: true, logout: vi.fn() }
  return { useAuth: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) }
})
vi.mock('@/features/sidebar/api', async (importActual) => ({
  ...await importActual<typeof import('@/features/sidebar/api')>(),
  ...sidebarActions,
  useSidebarState: () => ({ data: sidebarState }),
  useSidebarFolderFiles: () => ({ data: [] }),
  useFolderExpansion: (select: (value: { expanded: Record<string, boolean>; setExpanded: () => void }) => unknown) =>
    select({ expanded: { f1: true, f2: true, f3: true }, setExpanded: vi.fn() }),
}))
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
 * p1 0, p2 30, x1 60, x2 90, a 120, b 150, c 180 (shortcut rows come first when there are any).
 * Folder headers are not reorderable rows. Other elements span their rows.
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
const folderRow = (id: string) => document.querySelector(`aside [draggable][data-drop-target="${id}"]`)!

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
  sidebarState.shortcuts = []
})

describe('sidebar chat dragging outside the rows', () => {
  it('moves an unfiled chat to the end when dropped below the list', () => {
    dragTo(chatRow('a'), 10_000)
    expect(actions.reorderLooseChats).toHaveBeenCalledWith('a', 'c', 'after')
  })

  it('moves an unfiled chat to the top when dragged above the list', () => {
    dragTo(chatRow('c'), 110)
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

  it('pins a chat dragged into the pinned section at that spot', () => {
    dragTo(chatRow('b'), 5)
    expect(actions.pinChat).toHaveBeenCalledWith('b', { targetId: 'p1', edge: 'before' })
    dragTo(chatRow('x1'), 50, chatRow('p2'))
    expect(actions.pinChat).toHaveBeenCalledWith('x1', { targetId: 'p2', edge: 'after' })
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })

  it('unpins a pinned chat dragged into the unfiled list', () => {
    dragTo(chatRow('p1'), 10_000)
    expect(actions.unpinChat).toHaveBeenCalledWith('p1', null, { targetId: 'c', edge: 'after' })
    dragTo(chatRow('p2'), 155, chatRow('b'))
    expect(actions.unpinChat).toHaveBeenCalledWith('p2', null, { targetId: 'b', edge: 'before' })
    expect(actions.reorderPinnedChats).not.toHaveBeenCalled()
  })

  it('unpins a pinned chat dropped on a folder or among its chats', () => {
    dragTo(chatRow('p1'), 150, folderRow('f2'))
    expect(actions.unpinChat).toHaveBeenCalledWith('p1', 'f2')
    dragTo(chatRow('p2'), 110, chatRow('x2'))
    expect(actions.unpinChat).toHaveBeenCalledWith('p2', 'f1', { targetId: 'x2', edge: 'after' })
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })

  it('moves a folder into another folder dropped on', () => {
    dragTo(folderRow('f2'), 0, folderRow('f1'))
    expect(sidebarActions.moveSidebarFolder).toHaveBeenCalledWith('f2', 'f1')
  })

  it('does not move a folder into itself or its own subfolder', () => {
    dragTo(folderRow('f1'), 0, folderRow('f3'))
    dragTo(folderRow('f3'), 0, folderRow('f1'))
    expect(sidebarActions.moveSidebarFolder).not.toHaveBeenCalled()
  })

  it('moves a nested folder back to the top when dropped on the unfiled list', () => {
    dragTo(folderRow('f3'), 10_000)
    expect(sidebarActions.moveSidebarFolder).toHaveBeenCalledWith('f3', null)
  })

  it('still drops directly on rows and folder headers', () => {
    dragTo(chatRow('a'), 185, chatRow('c'))
    expect(actions.reorderLooseChats).toHaveBeenCalledWith('a', 'c', 'before')
    dragTo(chatRow('b'), 0, folderRow('f2'))
    expect(actions.moveToFolder).toHaveBeenCalledWith('b', 'f2')
  })

  it('leaves a chat in place when released next to where it started', () => {
    dragTo(chatRow('b'), 155)
    expect(actions.reorderLooseChats).not.toHaveBeenCalled()
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })
})

describe('sidebar shortcuts', () => {
  const remount = () => {
    cleanup()
    mount()
  }

  it('adds a shortcut for a chat or folder dragged into the shortcuts', () => {
    sidebarState.shortcuts = [{ id: 's1', targetKind: 'file', targetId: 'doc-1', name: 'Notes.md', kind: 'doc', systemRole: null }]
    remount()
    // The shortcut row is at 0-30, so the shortcuts end at 30.
    dragTo(chatRow('b'), 10)
    expect(sidebarActions.addShortcut).toHaveBeenCalledWith('chat', 'b')
    dragTo(folderRow('f2'), 10)
    expect(sidebarActions.addShortcut).toHaveBeenCalledWith('file', 'f2')
    expect(actions.pinChat).not.toHaveBeenCalled()
  })

  it('reorders shortcuts', () => {
    sidebarState.shortcuts = [
      { id: 's1', targetKind: 'file', targetId: 'doc-1', name: 'One.md', kind: 'doc', systemRole: null },
      { id: 's2', targetKind: 'file', targetId: 'doc-2', name: 'Two.md', kind: 'doc', systemRole: null },
    ]
    remount()
    const shortcut = (id: string) => document.querySelector(`[data-drag-list="shortcuts"][data-drag-id="${id}"]`)!
    dragTo(shortcut('s2'), 5, shortcut('s1'))
    expect(sidebarActions.reorderShortcuts).toHaveBeenCalledWith(['s2', 's1'])
  })
})
