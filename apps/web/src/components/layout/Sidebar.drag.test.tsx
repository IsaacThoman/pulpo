// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSidePanel } from '@/features/side-panel/store'
import type { FileNode, SidebarState } from '@pulpo/contracts'
import type { Chat } from '@/lib/types'
import type { ItemDropZone } from '@/features/files/browser/use-item-drag'

const sidebarActions = vi.hoisted(() => ({
  orderSidebarItems: vi.fn(),
  orderPinnedItems: vi.fn(),
  pinSidebarItems: vi.fn(),
  createSidebarFolder: vi.fn(),
  renameSidebarItem: vi.fn(),
  moveSidebarSelection: vi.fn(),
  trashSidebarSelection: vi.fn(),
  // The listings below stand in for the query cache the sidebar reads loaded items from.
  findSidebarItem: (id: string) => [...sidebarState.pinnedItems ?? [], ...Object.values(folderItems).flat()].find((item) => item.id === id),
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

const trashOps = vi.hoisted(() => ({ restore: vi.fn(async () => []), deleteForever: vi.fn(), empty: vi.fn() }))
vi.mock('@/features/trash/use-trash-operations', () => ({ useTrashOperations: () => trashOps }))

const chatActions = vi.hoisted(() => ({ duplicateChats: vi.fn(), copyChatShareLink: vi.fn() }))
vi.mock('@/features/chat/chat-actions', async (importActual) => ({
  ...await importActual<typeof import('@/features/chat/chat-actions')>(),
  ...chatActions,
}))

/** The zone the sidebar registers for items dragged in from the Files browser. */
const filesZone = vi.hoisted(() => ({ current: null as ItemDropZone | null }))
vi.mock('@/features/files/browser/use-item-drag', () => ({
  registerItemDropZone: (zone: ItemDropZone) => {
    filesZone.current = zone
    return () => undefined
  },
}))

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
const { useFileClipboard } = await import('@/features/files/browser/clipboard')

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

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

function mount(path = '/') {
  render(<QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar collapsed={false} mobile={false} mobileOpen={false} onToggle={vi.fn()} onNavigate={vi.fn()} onOpenSearch={vi.fn()} onOpenSettings={vi.fn()} />
        <CurrentPath />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>)
}

const chatRow = (id: string) => screen.getByRole('link', { name: `Chat ${id}` }).parentElement!
const folderRow = (id: string) => document.querySelector(`aside [data-folder-row="${id}"]`)!

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
  useSidePanel.setState({ content: null, tabs: [], activeId: null, hidden: false, closed: { tabs: [], activeId: null }, userId: null })
})

const fileRow = () => screen.getByRole('button', { name: 'Notes.md' }).parentElement!
const listRowIds = (list = 'pinned') => Array.from(document.querySelectorAll<HTMLElement>(`[data-drag-list="${list}"]`), (row) => row.dataset.dragId)
const TOP_LEVEL = ['a', 'f1', 'b', 'doc-1', 'f2', 's-proj', 'c']

describe('sidebar dragging', () => {
  it('moves an item to the end of the top level when dropped below everything', () => {
    dragTo(chatRow('a'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['f1', 'b', 'doc-1', 'f2', 's-proj', 'c', 'a'], undefined)
  })

  it('moves an item to the top when dragged above the list', () => {
    dragTo(chatRow('c'), 61)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['c', 'a', 'f1', 'b', 'doc-1', 'f2', 's-proj'], undefined)
  })

  it('reorders chats and folders together inside a folder', () => {
    dragTo(chatRow('x2'), 125, chatRow('x1').parentElement!)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('f1', ['x2', 'x1', 'f3'], undefined)
    expect(sidebarActions.moveSidebarSelection).not.toHaveBeenCalled()
  })

  it('places an item beside a folder from the edge of its header', () => {
    dragTo(chatRow('c'), 91, folderRow('f1'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'c', 'f1', 'b', 'doc-1', 'f2', 's-proj'], undefined)
    // The Projects shortcut is closed.
    dragTo(fileRow(), 329, folderRow('projects'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'b', 'f2', 's-proj', 'doc-1', 'c'], undefined)
  })

  it('files an item dropped on the bottom edge of an open folder into it, where its contents start', () => {
    dragTo(chatRow('c'), 119, folderRow('f1'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['c'], 'f1', { unpin: false })
    // f2 is open and empty.
    dragTo(fileRow(), 299, folderRow('f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['doc-1'], 'f2', { unpin: false })
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
  })

  it('files anything dropped on the middle of a folder into it', () => {
    dragTo(chatRow('b'), 285, folderRow('f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['b'], 'f2', { unpin: false })
    dragTo(fileRow(), 285, folderRow('f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['doc-1'], 'f2', { unpin: false })
    dragTo(folderRow('f2'), 105, folderRow('f1'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['f2'], 'f1', { unpin: false })
  })

  it('moves a folder chat out to the top level when dragged into a gap there', () => {
    dragTo(chatRow('x1'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'x1'], undefined)
  })

  it('reorders pinned chats from the header or the gaps between them', () => {
    dragTo(chatRow('p2'), -10)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['p2', 'p1'], undefined)
  })

  it('pins anything dragged into the pinned section at that spot', () => {
    dragTo(chatRow('b'), 5)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['b', 'p1', 'p2'], undefined)
    dragTo(chatRow('x1'), 50, chatRow('p2'))
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['p1', 'p2', 'x1'], undefined)
    dragTo(fileRow(), 5)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['doc-1', 'p1', 'p2'], undefined)
    dragTo(folderRow('f2'), 25)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['p1', 'f2', 'p2'], undefined)
  })

  it('unpins a pinned chat dropped among the items or on a folder', () => {
    dragTo(chatRow('p1'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'p1'], undefined)
    dragTo(chatRow('p2'), 125, chatRow('x1'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('f1', ['p2', 'x1', 'f3', 'x2'], undefined)
    dragTo(chatRow('p1'), 285, folderRow('f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['p1'], 'f2', { unpin: true })
    expect(sidebarActions.orderPinnedItems).not.toHaveBeenCalled()
  })

  it('does not move a folder into itself or its own subfolder', () => {
    dragTo(folderRow('f1'), 165, folderRow('f3'))
    dragTo(folderRow('f1'), 152, folderRow('f3'))
    expect(sidebarActions.moveSidebarSelection).not.toHaveBeenCalled()
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
  })

  it('moves a nested folder back to the top level when dropped there', () => {
    dragTo(folderRow('f3'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'f3'], undefined)
  })

  it('moves shortcuts like any other item', () => {
    dragTo(folderRow('projects'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'b', 'doc-1', 'f2', 'c', 's-proj'], undefined)
  })

  it('files a chat dropped on a folder shortcut into the folder it opens', () => {
    dragTo(chatRow('b'), 315, folderRow('projects'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['b'], 'projects', { unpin: false })
  })

  it('still drops directly on rows', () => {
    dragTo(chatRow('a'), 335, chatRow('c'))
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['f1', 'b', 'doc-1', 'f2', 's-proj', 'a', 'c'], undefined)
  })

  it('leaves an item in place when released next to where it started', () => {
    dragTo(chatRow('b'), 215)
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
    expect(sidebarActions.moveSidebarSelection).not.toHaveBeenCalled()
  })
})

describe('pinned folders and files', () => {
  const pinnedFolder = { ...node('pf', 'elsewhere', 'folder', 'Pinned folder', 2), pinned: true }
  const pinnedZone = () => document.querySelector('[data-pinned-zone]')!

  // Listed after the pinned chats: p1 0, p2 30, Pinned folder 60, then the top level from a 90.
  beforeEach(() => {
    cleanup()
    sidebarState.pinnedItems = [pinnedFolder]
    mount()
  })
  afterEach(() => { delete sidebarState.pinnedItems })

  it('lists them with the pinned chats, in one order', () => {
    expect(listRowIds()).toEqual(['p1', 'p2', 'pf'])
    expect(pinnedZone().contains(folderRow('pf'))).toBe(true)
  })

  it('reorders them with the pinned chats', () => {
    dragTo(folderRow('pf'), -10)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['pf', 'p1', 'p2'], undefined)
  })

  it('unpins one dropped among the items or on a folder', () => {
    dragTo(folderRow('pf'), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'pf'], undefined)
    dragTo(folderRow('pf'), 315, folderRow('f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['pf'], 'f2', { unpin: true })
  })

  it('pins and unpins from the item menu', async () => {
    fireEvent.contextMenu(folderRow('pf'), { clientX: 20, clientY: 60 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
    expect(sidebarActions.pinSidebarItems).toHaveBeenCalledWith(['pf'], false, [pinnedFolder])
    cleanup()
    mount()
    fireEvent.contextMenu(fileRow(), { clientX: 20, clientY: 270 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    expect(sidebarActions.pinSidebarItems).toHaveBeenCalledWith(['doc-1'], true, [folderItems.chats![1]])
  })

  it('pins a selection unless all of it is pinned already', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Pinned folder' }), { metaKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Notes.md' }), { metaKey: true })
    fireEvent.contextMenu(fileRow(), { clientX: 20, clientY: 270 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    expect(sidebarActions.pinSidebarItems).toHaveBeenCalledWith(['pf', 'doc-1'], true)
    fireEvent.click(screen.getByRole('button', { name: 'Pinned folder' }), { metaKey: true })
    fireEvent.click(screen.getByRole('link', { name: 'Chat p1' }), { metaKey: true })
    fireEvent.contextMenu(folderRow('pf'), { clientX: 20, clientY: 60 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
    expect(sidebarActions.pinSidebarItems).toHaveBeenCalledWith(['p1', 'pf'], false)
  })
})

describe('dropping items dragged from Files', () => {
  const fromFiles = (id: string, kind: FileNode['kind'] = 'doc') => node(id, 'elsewhere', kind, `Item ${id}`, 0)

  /** Hovers `nodes` over `target` at `clientY` and releases them; returns whether the sidebar took them. */
  function dropFromFiles(nodes: FileNode[], target: Element, clientY: number) {
    document.elementFromPoint = () => target
    const zone = filesZone.current!
    let placed = false
    act(() => { expect(zone.hover(10, clientY, nodes)).toBe(true) })
    act(() => { placed = zone.drop(nodes) })
    return placed
  }

  it('places them where the line shows, together and in order', () => {
    const nodes = [fromFiles('n1'), fromFiles('n2')]
    expect(dropFromFiles(nodes, chatRow('b'), 212)).toBe(true)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'n1', 'n2', 'b', 'doc-1', 'f2', 's-proj', 'c'], nodes)
  })

  it('files them into a folder from its middle, and beside it from its edges', () => {
    const nodes = [fromFiles('n1')]
    dropFromFiles(nodes, folderRow('f2'), 285)
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['n1'], 'f2', { unpin: true })
    dropFromFiles(nodes, folderRow('f2'), 271)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'b', 'doc-1', 'n1', 'f2', 's-proj', 'c'], nodes)
    dropFromFiles(nodes, folderRow('projects'), 329)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['a', 'f1', 'b', 'doc-1', 'f2', 's-proj', 'n1', 'c'], nodes)
  })

  it('files them into an open folder from the bottom edge of its header too', () => {
    const nodes = [fromFiles('n1')]
    dropFromFiles(nodes, folderRow('f2'), 299)
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['n1'], 'f2', { unpin: true })
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
  })

  it('snaps to the nearest top-level slot from empty space', () => {
    const nodes = [fromFiles('n1')]
    dropFromFiles(nodes, document.querySelector('aside .overflow-y-auto')!, 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', [...TOP_LEVEL, 'n1'], nodes)
  })

  it('pins them where the line shows in the pinned list', () => {
    const nodes = [fromFiles('n1'), fromFiles('n2')]
    expect(dropFromFiles(nodes, chatRow('p2'), 31)).toBe(true)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['p1', 'n1', 'n2', 'p2'], nodes)
    // From the Pinned heading, the nearest slot in the pinned list.
    expect(dropFromFiles(nodes, document.querySelector('[data-pinned-zone]')!, -10)).toBe(true)
    expect(sidebarActions.orderPinnedItems).toHaveBeenCalledWith(['n1', 'n2', 'p1', 'p2'], nodes)
  })

  it('does not put a folder inside itself', () => {
    expect(dropFromFiles([node('f1', 'chats', 'folder', 'Folder f1', 1)], folderRow('f3'), 165)).toBe(false)
    expect(sidebarActions.moveSidebarSelection).not.toHaveBeenCalled()
    expect(sidebarActions.orderSidebarItems).not.toHaveBeenCalled()
  })

  it('leaves drags outside the sidebar to Files', () => {
    document.elementFromPoint = () => document.body
    expect(filesZone.current!.hover(10, 10, [fromFiles('n1')])).toBe(false)
  })
})

describe('right-clicking empty sidebar space', () => {
  const menuItems = () => screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim())

  it('offers the top-level actions on empty space', async () => {
    fireEvent.contextMenu(document.querySelector('aside .overflow-y-auto')!, { clientX: 20, clientY: 600 })
    expect(await screen.findByRole('menuitem', { name: /Sort by/ })).toBeTruthy()
    expect(menuItems()).toEqual(expect.arrayContaining(['New chat', 'New folder', 'New file', 'Upload files', 'Paste', 'Open in Files']))
  })

  it('scopes the menu to an open folder, without sorting or a new chat', async () => {
    fireEvent.contextMenu(document.querySelector('[data-folder-body="f2"]')!, { clientX: 20, clientY: 280 })
    expect(await screen.findByRole('menuitem', { name: 'New folder' })).toBeTruthy()
    expect(menuItems()).not.toContain('New chat')
    expect(screen.queryByRole('menuitem', { name: /Sort by/ })).toBeNull()
  })

  it('restores items cut in the trash when pasted into a folder', async () => {
    const trashed = { ...node('t1', 'gone', 'blob', 'old.txt', 0), trashedAt: '2026-10-01T00:00:00.000Z' }
    useFileClipboard.setState({ clip: { mode: 'cut', nodes: [trashed] } })
    fireEvent.contextMenu(document.querySelector('[data-folder-body="f2"]')!, { clientX: 20, clientY: 280 })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Paste/ }))
    await vi.waitFor(() => expect(trashOps.restore).toHaveBeenCalledWith([trashed], { parentId: 'f2' }))
    expect(useFileClipboard.getState().clip).toBeNull()
  })

  it('leaves rows to their own menus', async () => {
    fireEvent.contextMenu(chatRow('a'), { clientX: 20, clientY: 60 })
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Sort by/ })).toBeNull()
  })
})

describe('menus of folders, files, and chats', () => {
  it('moves a folder from its menu, but not into itself or its own subfolders', async () => {
    fireEvent.contextMenu(folderRow('f1'), { clientX: 20, clientY: 90 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to folder' }))
    const option = async (name: string) => screen.findByRole('menuitem', { name })
    expect((await option('Folder f1')).getAttribute('aria-disabled')).toBe('true')
    expect((await option('Folder f3')).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(await option('Folder f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['f1'], 'f2')
  })

  it('opens files and folders in a new browser tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    fireEvent.contextMenu(fileRow(), { clientX: 20, clientY: 240 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in new browser tab' }))
    expect(open).toHaveBeenCalledWith('/files/d/doc-1', '_blank', 'noopener')
    open.mockRestore()
  })

  it('trashes a file or folder in one click while Shift is held, as chats are', () => {
    act(() => { fireEvent.keyDown(window, { key: 'Shift' }) })
    fireEvent.click(within(fileRow()).getByRole('button', { name: 'Move to trash' }))
    expect(sidebarActions.trashSidebarSelection).toHaveBeenCalledWith(['doc-1'])
    fireEvent.click(within(folderRow('f2') as HTMLElement).getByRole('button', { name: 'Move to trash' }))
    expect(sidebarActions.trashSidebarSelection).toHaveBeenCalledWith(['f2'])
    fireEvent.click(within(chatRow('a')).getByRole('button', { name: /chat$/ }))
    expect(sidebarActions.trashSidebarSelection).toHaveBeenCalledWith(['a'])
    act(() => { fireEvent.keyUp(window, { key: 'Shift' }) })
  })

  it('opens a chat to the left of the file in the main view, which moves into the panel', async () => {
    const fileId = '0b0e5d1c-6a3f-4e0a-9c55-2f7d8e9a1b2c'
    cleanup()
    mount(`/files/d/${fileId}`)
    fireEvent.contextMenu(chatRow('a'), { clientX: 20, clientY: 60 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open to the left' }))
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: fileId })
    expect(await screen.findByText('/c/a')).toBeTruthy()
  })

  it('offers no "Open to the left" beside a chat, where it would only open the chat', async () => {
    fireEvent.contextMenu(chatRow('a'), { clientX: 20, clientY: 60 })
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Open to the left' })).toBeNull()
  })

  it('duplicates a chat from its menu', async () => {
    fireEvent.contextMenu(chatRow('a'), { clientX: 20, clientY: 60 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    expect(chatActions.duplicateChats).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })])
  })
})

describe('creating a folder', () => {
  afterEach(() => {
    folderItems.chats = folderItems.chats!.filter((item) => item.id !== 'f-new')
  })

  it('adds an untitled folder and renames it in place', async () => {
    sidebarActions.createSidebarFolder.mockImplementation(async (name: string) => {
      const created = node('f-new', 'chats', 'folder', name, 0)
      folderItems.chats = [created, ...folderItems.chats!]
      return created
    })
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const input = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Rename folder' })
    expect(sidebarActions.createSidebarFolder).toHaveBeenCalledWith('Untitled folder', undefined)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input.value).toBe('Untitled folder')
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'Projects 2026' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sidebarActions.renameSidebarItem).toHaveBeenCalledWith('f-new', 'Projects 2026')
    expect(screen.queryByRole('textbox', { name: 'Rename folder' })).toBeNull()
  })
})

describe('selecting several rows', () => {
  const link = (id: string) => screen.getByRole('link', { name: `Chat ${id}` })
  const selected = () => Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-select]'))
    .filter((row) => row.className.includes('bg-sky-500/15'))
    .map((row) => row.dataset.sidebarSelect)

  it('toggles rows with Cmd/Ctrl-click and selects ranges with Shift-click', () => {
    fireEvent.click(link('a'), { metaKey: true })
    fireEvent.click(link('b'), { ctrlKey: true })
    expect(selected()).toEqual(['a', 'b'])
    fireEvent.click(screen.getByRole('button', { name: 'Notes.md' }), { shiftKey: true })
    expect(selected()).toEqual(['b', 'doc-1'])
    fireEvent.click(screen.getByRole('button', { name: 'Folder f2' }), { metaKey: true })
    expect(selected()).toEqual(['b', 'doc-1', 'f2'])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(selected()).toEqual([])
  })

  it('clears the selection on a plain click', () => {
    fireEvent.click(link('a'), { metaKey: true })
    fireEvent.click(link('c'))
    expect(selected()).toEqual([])
  })

  it('opens one menu for the whole selection from any selected row', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Notes.md' }), { metaKey: true })
    fireEvent.click(link('a'), { metaKey: true })
    fireEvent.contextMenu(chatRow('a'), { clientX: 20, clientY: 60 })
    expect(await screen.findByText('2 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }))
    expect(sidebarActions.trashSidebarSelection).toHaveBeenCalledWith(['a', 'doc-1'])
    expect(selected()).toEqual([])
  })

  it('leaves rows outside the selection to their own menus', async () => {
    fireEvent.click(link('a'), { metaKey: true })
    fireEvent.click(link('b'), { metaKey: true })
    fireEvent.contextMenu(chatRow('c'), { clientX: 20, clientY: 330 })
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.queryByText('2 selected')).toBeNull()
    expect(selected()).toEqual([])
  })

  it('drags the selection together, in sidebar order', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Notes.md' }), { metaKey: true })
    fireEvent.click(link('a'), { metaKey: true })
    dragTo(chatRow('a'), 285, folderRow('f2'))
    expect(sidebarActions.moveSidebarSelection).toHaveBeenCalledWith(['a', 'doc-1'], 'f2', { unpin: true })
    dragTo(fileRow(), 10_000)
    expect(sidebarActions.orderSidebarItems).toHaveBeenCalledWith('chats', ['f1', 'b', 'f2', 's-proj', 'c', 'a', 'doc-1'], undefined)
  })

  it('keeps a selected folder from being dragged into itself', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Folder f1' }), { metaKey: true })
    fireEvent.click(link('b'), { metaKey: true })
    dragTo(chatRow('b'), 165, document.querySelector('[data-folder-row="f3"]')!)
    expect(sidebarActions.moveSidebarSelection).not.toHaveBeenCalled()
  })
})
