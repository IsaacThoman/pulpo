// @vitest-environment node
import type { FileNode, SidebarState } from '@pulpo/contracts'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chats: [] as Array<Record<string, unknown>>,
  store: {
    moveChat: vi.fn(),
    togglePin: vi.fn(),
    archiveChat: vi.fn(async () => 'sent'),
  },
  api: {
    createSidebarFolder: vi.fn(),
    moveSidebarItems: vi.fn(async () => undefined),
    renameSidebarItem: vi.fn(async () => undefined),
    trashSidebarItems: vi.fn(async (ids: string[]) => ids),
    restoreSidebarItems: vi.fn(async () => undefined),
    archiveSidebarItems: vi.fn(async () => undefined),
    orderPinnedItems: vi.fn(async () => undefined),
    pinItems: vi.fn(async () => undefined),
    moveFileNodes: vi.fn(async () => []),
  },
  refreshFiles: vi.fn(async () => undefined),
  queueOfflineMutation: vi.fn(async () => undefined),
  namespace: 'https://pulpo.test|a',
  kept: new Map<string, unknown>(),
}))

vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID }))
vi.mock('../../api/client', () => ({ isNetworkError: (error: unknown) => (error as { network?: boolean } | null)?.network === true }))
vi.mock('../../data/database', () => ({
  getValue: async (_namespace: string, key: string) => mocks.kept.get(key) ?? null,
  setValue: async (_namespace: string, key: string, value: unknown) => { mocks.kept.set(key, value) },
}))
vi.mock('../../data/mutations', () => ({ queueOfflineMutation: mocks.queueOfflineMutation }))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({
  usePrototypeStore: {
    getState: () => ({ chats: mocks.chats, productionNamespace: mocks.namespace, ...mocks.store }),
    setState: (update: (state: { chats: typeof mocks.chats }) => { chats: typeof mocks.chats }) => { mocks.chats = update({ chats: mocks.chats }).chats },
  },
}))
vi.mock('../files/api', () => ({ pinItems: mocks.api.pinItems, moveFileNodes: mocks.api.moveFileNodes }))
vi.mock('../files/operations', () => ({ refreshFiles: mocks.refreshFiles }))
vi.mock('../files/display', () => ({
  filesErrorMessage: (error: unknown) => (error as Error).message,
  fileNameErrorMessage: (error: string) => error === 'invalid_character' ? 'Names can’t contain “/” or control characters.' : error,
}))
vi.mock('./api', () => mocks.api)

const { sidebarItemsFloor, sidebarOperations } = await import('./operations')
const { sidebarKeys } = await import('./queries')
const { useSidebarExpansion } = await import('./expansion')

const NAMESPACE = 'https://pulpo.test|a'
const CHATS = '00000000-0000-4000-8000-000000000001'
const ARCHIVE = '00000000-0000-4000-8000-000000000002'
const at = new Date(1_000).toISOString()

function node(id: string, patch: Partial<FileNode> = {}): FileNode {
  return { id, parentId: CHATS, kind: 'folder', name: id, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, trashedAt: null, createdAt: at, updatedAt: at, systemRole: null, sortOrder: 0, ...patch }
}

function chat(id: string, patch: Record<string, unknown> = {}) {
  return { id, title: id, pinned: false, folderId: null, sortOrder: 0, createdAt: 1, deletedAt: null, temporary: false, ...patch }
}

let client: QueryClient
const show = vi.fn()
const operations = () => sidebarOperations(client, NAMESPACE, show)
const state = () => client.getQueryData<SidebarState>(sidebarKeys.state(NAMESPACE))!
const listing = (folderId: string) => client.getQueryData<FileNode[]>(sidebarKeys.items(NAMESPACE, folderId))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.kept.clear()
  mocks.chats = []
  mocks.namespace = NAMESPACE
  useSidebarExpansion.setState({ namespace: '', expanded: new Set() })
  client = new QueryClient()
  client.setQueryData<SidebarState>(sidebarKeys.state(NAMESPACE), {
    chatsFolderId: CHATS,
    archiveFolderId: ARCHIVE,
    folders: [
      { id: CHATS, parentId: null, name: 'Sidebar', systemRole: 'chats' },
      { id: ARCHIVE, parentId: null, name: 'Archive', systemRole: 'archive' },
      { id: 'work', parentId: CHATS, name: 'work', systemRole: null },
      { id: 'inner', parentId: 'work', name: 'inner', systemRole: null },
    ],
    pinnedItems: [node('pinned-doc', { kind: 'doc', parentId: 'work', pinned: true, sortOrder: 3 })],
  })
  client.setQueryData(sidebarKeys.items(NAMESPACE, CHATS), [node('work', { sortOrder: -2 }), node('notes', { kind: 'doc', sortOrder: 1 })])
  client.setQueryData(sidebarKeys.items(NAMESPACE, 'work'), [node('inner', { parentId: 'work' })])
})

describe('creating a folder in the drawer', () => {
  it('shows it at once at the top of the sidebar, sent with its own id', async () => {
    mocks.api.createSidebarFolder.mockResolvedValue(undefined)
    const created = await operations().createFolder(null, ' Plans ')
    expect(created).toMatchObject({ name: 'Plans', parentId: CHATS, sortOrder: -3 })
    expect(listing(CHATS)![0]).toEqual(created)
    expect(state().folders.at(-1)).toEqual({ id: created!.id, parentId: CHATS, name: 'Plans', systemRole: null })
    expect(mocks.api.createSidebarFolder).toHaveBeenCalledWith({ id: created!.id, parentId: null, name: 'Plans' })
    expect(mocks.refreshFiles).toHaveBeenCalled()
  })

  it('opens the folder it is created in', async () => {
    mocks.api.createSidebarFolder.mockResolvedValue(undefined)
    const created = await operations().createFolder('work', 'Q4')
    expect(mocks.api.createSidebarFolder).toHaveBeenCalledWith({ id: created!.id, parentId: 'work', name: 'Q4' })
    expect(listing('work')![0]?.id).toBe(created!.id)
    expect(useSidebarExpansion.getState().expanded.has('work')).toBe(true)
  })

  it('is kept for later offline', async () => {
    mocks.api.createSidebarFolder.mockRejectedValue({ network: true })
    const created = await operations().createFolder(null, 'Offline')
    expect(mocks.queueOfflineMutation).toHaveBeenCalledWith({
      namespace: NAMESPACE, entityKey: `folder:${created!.id}`, method: 'POST', path: '/api/sidebar/folders', body: { id: created!.id, parentId: null, name: 'Offline' },
    })
    expect(listing(CHATS)![0]?.id).toBe(created!.id)
    expect(mocks.refreshFiles).not.toHaveBeenCalled()
    // Where it went is kept, so it stays there until the server has it.
    expect(mocks.kept.get(`sidebar:pending-order:${created!.id}`)).toBe(created!.sortOrder)
  })

  it('refuses a name the server would, before showing or keeping anything', async () => {
    mocks.api.createSidebarFolder.mockRejectedValue({ network: true })
    await expect(operations().createFolder(null, 'Work/Personal')).resolves.toBeUndefined()
    expect(show).toHaveBeenCalledWith({ message: 'Names can’t contain “/” or control characters.', tone: 'error' })
    expect(listing(CHATS)!.map((item) => item.id)).toEqual(['work', 'notes'])
    expect(mocks.queueOfflineMutation).not.toHaveBeenCalled()
    await operations().rename(node('inner', { parentId: 'work' }), 'a/b')
    expect(mocks.api.renameSidebarItem).not.toHaveBeenCalled()
  })

  it('reports a refusal', async () => {
    mocks.api.createSidebarFolder.mockRejectedValue(new Error('Too deep'))
    await expect(operations().createFolder(null, 'Nope')).resolves.toBeUndefined()
    expect(show).toHaveBeenCalledWith({ message: 'Too deep', tone: 'error' })
    expect(mocks.queueOfflineMutation).not.toHaveBeenCalled()
  })
})

describe('moving in the drawer', () => {
  it('moves an item to the top of its new folder, at once', async () => {
    mocks.chats = [chat('in-work', { folderId: 'work', sortOrder: -4 })]
    await operations().move({ kind: 'node', node: node('notes', { kind: 'doc', sortOrder: 1 }) }, 'work')
    expect(listing(CHATS)!.map((item) => item.id)).toEqual(['work'])
    expect(listing('work')!.map((item) => [item.id, item.sortOrder])).toEqual([['notes', -5], ['inner', 0]])
    expect(mocks.api.moveSidebarItems).toHaveBeenCalledWith(['notes'], 'work')
    expect(show).not.toHaveBeenCalled()
  })

  it('moves to the top of the sidebar as the sidebar names it, and keeps a pinned item pinned', async () => {
    const pinned = state().pinnedItems![0]!
    await operations().move({ kind: 'node', node: pinned }, CHATS)
    expect(mocks.api.moveSidebarItems).toHaveBeenCalledWith(['pinned-doc'], null)
    expect(state().pinnedItems![0]).toMatchObject({ id: 'pinned-doc', parentId: CHATS, pinned: true })
    expect(listing(CHATS)!.some((item) => item.id === 'pinned-doc')).toBe(false)
  })

  it('moves a folder’s place in the tree too', async () => {
    await operations().move({ kind: 'node', node: node('inner', { parentId: 'work' }) }, null)
    expect(state().folders.find((folder) => folder.id === 'inner')?.parentId).toBe(CHATS)
  })

  it('moves a chat above the destination’s Files items', async () => {
    await operations().move({ kind: 'chat', id: 'c', name: 'c', folderId: 'work', inFilesRoot: false, pinned: false }, null)
    expect(mocks.store.moveChat).toHaveBeenCalledWith('c', null, { floor: -2, sendSortOrder: false })
    expect(sidebarItemsFloor(client, NAMESPACE, 'missing')).toBeUndefined()
  })

  it('brings a chat from the top of My files into the sidebar', async () => {
    await operations().move({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: true, pinned: true }, null)
    expect(mocks.store.moveChat).toHaveBeenCalledWith('c', null, { floor: -2, sendSortOrder: false })
  })

  it('tells servers without the sidebar where a chat goes', async () => {
    client.setQueryData(sidebarKeys.state(NAMESPACE), null)
    await operations().move({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: false, pinned: false }, 'legacy-folder')
    expect(mocks.store.moveChat).toHaveBeenCalledWith('c', 'legacy-folder', { floor: undefined, sendSortOrder: true })
    await operations().setPinned({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: false, pinned: false }, true)
    expect(mocks.store.togglePin).toHaveBeenCalledWith('c', -1, { floor: undefined, sendSortOrder: true })
  })

  it('leaves things where they already are', async () => {
    await operations().move({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: false, pinned: false }, CHATS)
    await operations().move({ kind: 'node', node: node('work') }, null)
    expect(mocks.store.moveChat).not.toHaveBeenCalled()
    expect(mocks.api.moveSidebarItems).not.toHaveBeenCalled()
  })
})

describe('pinning in the drawer', () => {
  it('pins an item after everything pinned, out of its folder', async () => {
    mocks.chats = [chat('pinned-chat', { pinned: true, sortOrder: 8 })]
    await operations().setPinned({ kind: 'node', node: node('notes', { kind: 'doc', sortOrder: 1 }) }, true)
    expect(state().pinnedItems!.map((item) => [item.id, item.sortOrder])).toEqual([['pinned-doc', 3], ['notes', 9]])
    expect(listing(CHATS)!.map((item) => item.id)).toEqual(['work'])
    expect(mocks.api.pinItems).toHaveBeenCalledWith(['notes'], true)
  })

  it('unpins an item back to the top of its folder', async () => {
    await operations().setPinned({ kind: 'node', node: state().pinnedItems![0]! }, false)
    expect(state().pinnedItems).toEqual([])
    expect(listing('work')![0]).toMatchObject({ id: 'pinned-doc', pinned: false, sortOrder: -1 })
  })

  it('unpins a chat at the top of My files the way the sidebar does, which keeps it there', async () => {
    mocks.chats = [chat('c', { pinned: true, inFilesRoot: true })]
    await operations().setPinned({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: true, pinned: true }, false)
    expect(mocks.api.pinItems).toHaveBeenCalledWith(['c'], false)
    expect(mocks.store.togglePin).not.toHaveBeenCalled()
    expect(mocks.chats[0]).toMatchObject({ pinned: false })
    mocks.api.pinItems.mockRejectedValueOnce(new Error('No'))
    mocks.chats = [chat('c', { pinned: true, inFilesRoot: true })]
    await operations().setPinned({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: true, pinned: true }, false)
    expect(mocks.chats[0]).toMatchObject({ pinned: true })
  })

  it('pins a chat after the pinned Files items, and unpins it above its folder’s items', async () => {
    await operations().setPinned({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: false, pinned: false }, true)
    expect(mocks.store.togglePin).toHaveBeenLastCalledWith('c', 3, { floor: -2, sendSortOrder: false })
    await operations().setPinned({ kind: 'chat', id: 'c', name: 'c', folderId: 'work', inFilesRoot: false, pinned: true }, false)
    expect(mocks.store.togglePin).toHaveBeenLastCalledWith('c', 3, { floor: 0, sendSortOrder: false })
    await operations().setPinned({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: false, pinned: true }, true)
    expect(mocks.store.togglePin).toHaveBeenCalledTimes(2)
  })
})

describe('archiving in the drawer', () => {
  it('archives an item and puts it back, pinned in its old place, on undo', async () => {
    mocks.chats = [chat('pinned-chat', { pinned: true, sortOrder: 5 })]
    await operations().archive({ kind: 'node', node: state().pinnedItems![0]! })
    expect(state().pinnedItems).toEqual([])
    expect(mocks.api.archiveSidebarItems).toHaveBeenCalledWith({ chatIds: [], fileIds: ['pinned-doc'] })
    const toast = show.mock.calls.at(-1)![0] as { message: string; undo: () => Promise<void> }
    expect(toast.message).toBe('Moved “pinned-doc” to the archive')
    await toast.undo()
    expect(mocks.api.moveSidebarItems).toHaveBeenCalledWith(['pinned-doc'], 'work')
    expect(mocks.api.orderPinnedItems).toHaveBeenCalledWith(['pinned-doc', 'pinned-chat'])
    expect(mocks.refreshFiles).toHaveBeenLastCalledWith(client, NAMESPACE, true)
  })

  it('puts something archived from the top of My files back there, through Files', async () => {
    await operations().archive({ kind: 'node', node: node('loose-doc', { kind: 'doc', parentId: null }) })
    await (show.mock.calls.at(-1)![0] as { undo: () => Promise<void> }).undo()
    expect(mocks.api.moveFileNodes).toHaveBeenCalledWith([{ id: 'loose-doc', parentId: null }])
    expect(mocks.api.moveSidebarItems).not.toHaveBeenCalled()
    await operations().archive({ kind: 'chat', id: 'c', name: 'c', folderId: null, inFilesRoot: true, pinned: false })
    await (show.mock.calls.at(-1)![0] as { undo: () => Promise<void> }).undo()
    expect(mocks.api.moveFileNodes).toHaveBeenLastCalledWith([{ id: 'c', parentId: null }])
  })

  it('offers no undo for a chat archived offline, and says nothing when the server refuses', async () => {
    mocks.store.archiveChat.mockResolvedValueOnce('queued')
    await operations().archive({ kind: 'chat', id: 'c', name: 'Plans', folderId: null, inFilesRoot: false, pinned: false })
    expect(show).toHaveBeenLastCalledWith({ message: '“Plans” will move to the archive once you’re back online' })
    show.mockClear()
    mocks.store.archiveChat.mockResolvedValueOnce('failed')
    await operations().archive({ kind: 'chat', id: 'c', name: 'Plans', folderId: null, inFilesRoot: false, pinned: false })
    expect(show).not.toHaveBeenCalled()
  })

  it('archives a chat through the chat list, which keeps it for later offline', async () => {
    mocks.chats = [chat('c', { folderId: ARCHIVE })]
    await operations().archive({ kind: 'chat', id: 'c', name: 'Plans', folderId: null, inFilesRoot: false, pinned: false })
    expect(mocks.store.archiveChat).toHaveBeenCalledWith('c', ARCHIVE)
    const toast = show.mock.calls.at(-1)![0] as { undo: () => Promise<void> }
    const undone = toast.undo()
    // Back at once, before the server answers.
    expect(mocks.chats[0]).toMatchObject({ folderId: null, inFilesRoot: false })
    await undone
    expect(mocks.api.moveSidebarItems).toHaveBeenCalledWith(['c'], null)
    expect(mocks.api.orderPinnedItems).not.toHaveBeenCalled()
  })

  it('says nothing more when the server refuses', async () => {
    mocks.api.archiveSidebarItems.mockRejectedValueOnce(new Error('No'))
    await operations().archive({ kind: 'node', node: node('notes', { kind: 'doc' }) })
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith({ message: 'No', tone: 'error' })
  })
})

describe('trashing in the drawer', () => {
  it('trashes a folder with the folders inside it, puts its chats at the top, and restores it on undo', async () => {
    mocks.chats = [chat('in-inner', { folderId: 'inner' }), chat('loose')]
    await operations().trash(node('work', { sortOrder: -2 }))
    expect(state().folders.map((folder) => folder.id)).toEqual([CHATS, ARCHIVE])
    expect(listing(CHATS)!.map((item) => item.id)).toEqual(['notes'])
    expect(listing('work')).toEqual([])
    expect(mocks.chats.map((item) => item.folderId)).toEqual([null, null])
    const toast = show.mock.calls.at(-1)![0] as { message: string; undo: () => Promise<void> }
    expect(toast.message).toBe('Moved “work” to the trash')
    await toast.undo()
    expect(mocks.api.restoreSidebarItems).toHaveBeenCalledWith(['work'])
  })

  it('says nothing about an action that finished after switching accounts', async () => {
    const trashing = operations().trash(node('work'))
    mocks.namespace = 'https://other.test|b'
    await trashing
    expect(show).not.toHaveBeenCalled()
  })

  it('puts a folder’s chats back when trashing it is refused', async () => {
    mocks.chats = [chat('in-inner', { folderId: 'inner', pinned: true, sortOrder: 4 })]
    mocks.api.trashSidebarItems.mockRejectedValueOnce(new Error('No'))
    await operations().trash(node('work', { sortOrder: -2 }))
    expect(mocks.chats[0]).toMatchObject({ folderId: 'inner', pinned: true, sortOrder: 4 })
    expect(show).toHaveBeenCalledWith({ message: 'No', tone: 'error' })
  })

  it('puts an archived chat back in the archive when its Undo is refused', async () => {
    mocks.chats = [chat('c', { folderId: ARCHIVE })]
    await operations().archive({ kind: 'chat', id: 'c', name: 'c', folderId: 'work', inFilesRoot: false, pinned: true })
    mocks.api.moveSidebarItems.mockRejectedValueOnce(new Error('Offline'))
    await (show.mock.calls.at(-1)![0] as { undo: () => Promise<void> }).undo()
    expect(mocks.chats[0]).toMatchObject({ folderId: ARCHIVE, pinned: false })
  })

  it('deletes a shortcut', async () => {
    await operations().trash(node('to-x', { kind: 'shortcut' }))
    expect((show.mock.calls.at(-1)![0] as { message: string }).message).toBe('Deleted “to-x”')
  })
})

describe('renaming in the drawer', () => {
  it('renames it wherever the drawer shows it', async () => {
    await operations().rename(node('inner', { parentId: 'work' }), ' Inner ')
    expect(state().folders.find((folder) => folder.id === 'inner')?.name).toBe('Inner')
    expect(listing('work')![0]?.name).toBe('Inner')
    expect(mocks.api.renameSidebarItem).toHaveBeenCalledWith('inner', 'Inner')
    await operations().rename(node('inner'), 'inner')
    expect(mocks.api.renameSidebarItem).toHaveBeenCalledTimes(1)
  })
})
