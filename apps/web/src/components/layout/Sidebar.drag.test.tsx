// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { FileNode, SidebarState } from '@pulpo/contracts'
import type { Chat } from '@/lib/types'

const actions = vi.hoisted(() => ({
  reorderPinnedChats: vi.fn(),
  moveToFolder: vi.fn(),
  pinChat: vi.fn(),
  unpinChat: vi.fn(),
}))

const sidebarActions = vi.hoisted(() => ({
  moveSidebarItems: vi.fn(),
  orderSidebarItems: vi.fn(),
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
} as SidebarState))

const node = (id: string, parentId: string, kind: FileNode['kind'], name: string, sortOrder: number, target: FileNode['target'] = null): FileNode => ({
  id, parentId, kind, name, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, trashedAt: null,
  createdAt: '', updatedAt: '', systemRole: null, sortOrder, target,
})

/** What each open folder lists besides chats: the sidebar's top level is the Chats folder. */
const folderItems = vi.hoisted(() => ({} as Record<string, FileNode[]>))
Object.assign(folderItems, {
  chats: [
    node('f1', 'chats', 'folder', 'Folder f1', 1),
    node('doc-1', 'chats', 'doc', 'Notes.md', 3),
    node('f2', 'chats', 'folder', 'Folder f2', 4),
    node('s-proj', 'chats', 'shortcut', 'Projects', 5, { kind: 'folder', id: 'projects', name: 'Projects', mimeType: null, systemRole: null, available: true }),
  ],
  f1: [node('f3', 'f1', 'folder', 'Folder f3', 1)],
})

vi.mock('@/stores/chat', () => {
  const chat = (id: string, sortOrder: number, patch: Partial<Chat> = {}): Chat => ({
    id, title: `Chat ${id}`, modelId: 'model', messages: [], createdAt: 0, updatedAt: 0, pinned: false,
    folderId: null, sortOrder, tags: [], temporary: false, expiresAt: null, expired: false, ...patch,
  })
  const state = {
    chats: [
      chat('p1', 0, { pinned: true }), chat('p2', 1, { pinned: true }),
      chat('x1', 0, { folderId: 'f1' }), chat('x2', 2, { folderId: 'f1' }),
      chat('a', 0), chat('b', 2), chat('c', 6),
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
  useSidebarItems: (folderId: string | undefined) => ({ data: folderItems[folderId ?? ''] ?? [] }),
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
 * jsdom has no layout, so stack every reorderable row 30px apart in document order. Chats and
 * Files items share one order in each folder:
 *   pinned p1 0, p2 30
 *   top level a 60, f1 90 [x1 120, f3 150, x2 180], b 210, Notes.md 240, f2 270, Projects 300, c 330
 * Other elements span their rows.
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
})

const fileRow = () => screen.getByRole('button', { name: 'Notes.md' }).parentElement!
const TOP_LEVEL = ['a', 'f1', 'b', 'doc-1', 'f2', 's-proj', 'c']

describe('sidebar dragging', () => {
  it('moves an item to the end of the top level when dropped below everything', () => {
    dragTo(chatRow('a'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['f1', 'b', 'doc-1', 'f2', 's-proj', 'c', 'a'])
  })

  it('moves an item to the top when dragged above the list', () => {
    dragTo(chatRow('c'), 61)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['c', 'a', 'f1', 'b', 'doc-1', 'f2', 's-proj'])
  })

  it('reorders chats and folders together inside a folder', () => {
    dragTo(chatRow('x2'), 125, chatRow('x1').parentElement!)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('f1', ['x2', 'x1', 'f3'])
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })

  it('places an item beside a folder from the edge of its header', () => {
    dragTo(chatRow('c'), 91, folderRow('f1'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'c', 'f1', 'b', 'doc-1', 'f2', 's-proj'])
    dragTo(fileRow(), 119, folderRow('f1'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'doc-1', 'b', 'f2', 's-proj', 'c'])
  })

  it('files anything dropped on the middle of a folder into it', () => {
    dragTo(chatRow('b'), 285, folderRow('f2'))
    expect(actions.moveToFolder).toHaveBeenCalledWith('b', 'f2')
    dragTo(fileRow(), 285, folderRow('f2'))
    expect(sidebarActions.moveSidebarItems).toHaveBeenCalledWith(['doc-1'], 'f2')
    dragTo(folderRow('f2'), 105, folderRow('f1'))
    expect(sidebarActions.moveSidebarItems).toHaveBeenCalledWith(['f2'], 'f1')
  })

  it('moves a folder chat out to the top level when dragged into a gap there', () => {
    dragTo(chatRow('x1'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'x1'])
  })

  it('reorders pinned chats from the header or the gaps between them', () => {
    dragTo(chatRow('p2'), -10)
    expect(actions.reorderPinnedChats).toHaveBeenCalledWith('p2', 'p1', 'before')
  })

  it('pins a chat dragged into the pinned section at that spot, but not other items', () => {
    dragTo(chatRow('b'), 5)
    expect(actions.pinChat).toHaveBeenCalledWith('b', { targetId: 'p1', edge: 'before' })
    dragTo(chatRow('x1'), 50, chatRow('p2'))
    expect(actions.pinChat).toHaveBeenCalledWith('x1', { targetId: 'p2', edge: 'after' })
    dragTo(fileRow(), 5)
    expect(actions.pinChat).toHaveBeenCalledTimes(2)
  })

  it('unpins a pinned chat dropped among the items or on a folder', () => {
    dragTo(chatRow('p1'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'p1'])
    dragTo(chatRow('p2'), 125, chatRow('x1'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('f1', ['p2', 'x1', 'f3', 'x2'])
    dragTo(chatRow('p1'), 285, folderRow('f2'))
    expect(actions.unpinChat).toHaveBeenCalledWith('p1', 'f2')
    expect(actions.reorderPinnedChats).not.toHaveBeenCalled()
  })

  it('does not move a folder into itself or its own subfolder', () => {
    dragTo(folderRow('f1'), 165, folderRow('f3'))
    dragTo(folderRow('f1'), 152, folderRow('f3'))
    expect(sidebarActions.moveSidebarItems).not.toHaveBeenCalled()
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
  })

  it('moves a nested folder back to the top level when dropped there', () => {
    dragTo(folderRow('f3'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'f3'])
  })

  it('moves shortcuts like any other item', () => {
    dragTo(folderRow('projects'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'b', 'doc-1', 'f2', 'c', 's-proj'])
  })

  it('files a chat dropped on a folder shortcut into the folder it opens', () => {
    dragTo(chatRow('b'), 315, folderRow('projects'))
    expect(actions.moveToFolder).toHaveBeenCalledWith('b', 'projects')
  })

  it('still drops directly on rows', () => {
    dragTo(chatRow('a'), 335, chatRow('c'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['f1', 'b', 'doc-1', 'f2', 's-proj', 'a', 'c'])
  })

  it('leaves an item in place when released next to where it started', () => {
    dragTo(chatRow('b'), 215)
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
    expect(actions.moveToFolder).not.toHaveBeenCalled()
  })
})
