import { useQuery } from '@tanstack/react-query'
import type { FileColor, FileIcon, FileListing, FileNode, SidebarFolder, SidebarState } from '@pulpo/contracts'
import { create } from 'zustand'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { topOrderIn, useChat } from '@/stores/chat'
import { pinnedItemsCeiling, sidebarItemsKey, sidebarQueryKey } from './cache'
import { useSettings } from '@/stores/settings'
import { ui, uit } from '@/i18n/ui'
import { createDoc, folderQueryKey, moveFileNodes, uploadFile } from '@/features/files/api'
import { createRecording } from '@/features/files/recording/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { useFileToasts } from '@/features/files/browser/toasts'

/*
 * The sidebar is the Chats folder in Files: its folders, shortcuts, files, and chats. Everything
 * here lives under ['folders', userId], which the 'folders' and 'files' realtime scopes refresh.
 */
export { sidebarItemsKey, sidebarQueryKey }

export function useSidebarState() {
  const userId = useAuth((state) => state.user?.id)
  const role = useAuth((state) => state.user?.role)
  const instanceReady = useAuth((state) => state.instanceReady)
  return useQuery({
    queryKey: sidebarQueryKey(userId),
    queryFn: ({ signal }) => apiRequest<SidebarState>('/api/sidebar', { signal }),
    enabled: Boolean(userId && role !== 'pending' && (!isDesktopRuntime() || instanceReady)),
    // The persisted copy can predate the last change made before a reload; it is shown at once
    // and checked on every mount.
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/** A folder's subfolders, shortcuts, and files (its chats come from the chat list), once open. */
export function useSidebarItems(folderId: string | undefined, enabled = true) {
  const userId = useAuth((state) => state.user?.id)
  return useQuery({
    queryKey: sidebarItemsKey(userId, folderId ?? ''),
    queryFn: ({ signal }) => apiRequest<{ items: FileNode[] }>(`/api/sidebar/folders/${folderId}/items`, { signal }).then((result) => result.items),
    enabled: Boolean(userId && folderId && enabled),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

const currentKey = () => sidebarQueryKey(useAuth.getState().user?.id)
const readState = () => queryClient.getQueryData<SidebarState>(currentKey())
const writeState = (update: (state: SidebarState) => SidebarState) => {
  queryClient.setQueryData<SidebarState>(currentKey(), (state) => state && update(state))
}
/** Applies a change to every loaded folder listing in the sidebar. */
const writeItems = (update: (items: FileNode[]) => FileNode[]) => {
  queryClient.setQueriesData<FileNode[]>({ queryKey: ['folders', useAuth.getState().user?.id, 'items'] }, (items) => items && update(items))
}
const readPinned = () => readState()?.pinnedItems ?? []
/** Applies a change to the pinned Files items the sidebar lists with the pinned chats. */
const writePinned = (update: (items: FileNode[]) => FileNode[]) => writeState((state) => ({ ...state, pinnedItems: update(state.pinnedItems ?? []) }))
/** Applies a change to every item of every loaded Files listing. */
const writeListings = (update: (item: FileNode) => FileNode) => {
  queryClient.setQueriesData<FileListing>({ queryKey: folderQueryKey(useAuth.getState().user?.id, null).slice(0, -1) }, (listing) =>
    listing && { ...listing, children: listing.children.map(update) })
}
const refresh = () => Promise.all([
  queryClient.invalidateQueries({ queryKey: ['folders', useAuth.getState().user?.id] }),
  queryClient.invalidateQueries({ queryKey: ['files', useAuth.getState().user?.id] }),
])

/** Refetches the sidebar and Files listings after a change made elsewhere (e.g. a paste). */
export const refreshSidebar = refresh

/**
 * Runs a sidebar change shown at once, then confirmed (or undone) by refetching. A failure is
 * reported in a toast, as in Files, and resolves to undefined.
 */
async function mutate<T>(optimistic: (() => void) | null, request: () => Promise<T>, name?: string): Promise<T | undefined> {
  optimistic?.()
  try {
    return await request()
  } catch (cause) {
    useFileToasts.getState().show({ message: filesErrorMessage(cause, name), tone: 'error' })
    return undefined
  } finally {
    await refresh()
  }
}

/** Where a chat or Files item is, to put it back when a change is undone. */
interface Placement {
  id: string
  name: string
  /** The Files folder it is in; null is the top of My files. */
  parentId: string | null
  pinned: boolean
}

/** Where `ids` are now. `nodes` are Files items among them the sidebar may not have loaded. */
function placements(ids: readonly string[], nodes: readonly FileNode[] = []): Placement[] {
  const chatsFolderId = readState()?.chatsFolderId ?? null
  const chats = new Map(useChat.getState().chats.map((chat) => [chat.id, chat]))
  return ids.flatMap((id) => {
    const chat = chats.get(id)
    if (chat) return [{ id, name: chat.title, parentId: chat.inFilesRoot ? null : chat.folderId ?? chatsFolderId, pinned: chat.pinned }]
    const node = nodes.find((candidate) => candidate.id === id) ?? findSidebarItem(id)
    return node ? [{ id, name: node.name, parentId: node.parentId, pinned: Boolean(node.pinned) }] : []
  })
}

/** The pinned list, chats and Files items, in order. */
function pinnedOrder(): string[] {
  return [
    ...useChat.getState().chats.filter((chat) => chat.pinned).map((chat) => ({ id: chat.id, sortOrder: chat.sortOrder, createdAt: chat.createdAt })),
    ...readPinned().map((item) => ({ id: item.id, sortOrder: item.sortOrder ?? 0, createdAt: Date.parse(item.createdAt) })),
  ].sort((left, right) => left.sortOrder - right.sortOrder || right.createdAt - left.createdAt).map((entry) => entry.id)
}

/**
 * Puts chats and Files items back where `before` found them, and back in the pinned list, in its
 * old order (`pinnedBefore`), if they were pinned. Throws when the server refuses.
 */
async function putBack(before: readonly Placement[], pinnedBefore: readonly string[]): Promise<void> {
  const chatsFolderId = readState()?.chatsFolderId
  const byParent = new Map<string | null, string[]>()
  for (const place of before) byParent.set(place.parentId, [...byParent.get(place.parentId) ?? [], place.id])
  useChat.setState((state) => ({
    chats: state.chats.map((chat) => {
      const place = before.find((candidate) => candidate.id === chat.id)
      return place ? { ...chat, folderId: place.parentId === chatsFolderId ? null : place.parentId, inFilesRoot: place.parentId === null } : chat
    }),
  }))
  try {
    // Only Files moves things to the top of My files; the sidebar moves the rest, with Files off too.
    await Promise.all([...byParent].map(([parentId, ids]) => parentId === null
      ? moveFileNodes(ids.map((id) => ({ id, parentId: null })))
      : apiRequest('/api/sidebar/move', { method: 'POST', body: { ids, parentId } })))
    if (before.some((place) => place.pinned)) {
      const current = new Set([...pinnedOrder(), ...before.map((place) => place.id)])
      await apiRequest('/api/sidebar/pinned', { method: 'PUT', body: { ids: pinnedBefore.filter((id) => current.has(id)) } })
    }
  } finally {
    await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['chats', useAuth.getState().user?.id] })])
  }
}

/** "Moved "Notes" to the trash" for one item, "Moved 3 items to the trash" for several. */
function describe(places: readonly Placement[], one: (name: string) => string, many: (count: number) => string): string {
  return places.length === 1 ? one(places[0]!.name) : many(places.length)
}

const announce = (message: string, undo?: () => Promise<unknown>) => useFileToasts.getState().show({ message, undo })

export function sortFolders(folders: readonly SidebarFolder[]): SidebarFolder[] {
  return [...folders].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export function childFolders(state: SidebarState | undefined, parentId: string): SidebarFolder[] {
  return sortFolders(state?.folders.filter((folder) => folder.parentId === parentId) ?? [])
}

/** Every folder a chat can be moved into from the sidebar, depth-first with its nesting depth. */
export function folderOutline(state: SidebarState | undefined): Array<{ folder: SidebarFolder; depth: number }> {
  if (!state) return []
  const outline: Array<{ folder: SidebarFolder; depth: number }> = []
  const walk = (parentId: string, depth: number) => {
    for (const folder of childFolders(state, parentId)) {
      outline.push({ folder, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(state.chatsFolderId, 0)
  const archive = state.folders.find((folder) => folder.id === state.archiveFolderId)
  if (archive) {
    outline.push({ folder: archive, depth: 0 })
    walk(archive.id, 1)
  }
  return outline
}

/** Whether `folderId` is `ancestorId` or inside it. */
export function isWithin(state: SidebarState | undefined, folderId: string, ancestorId: string): boolean {
  const byId = new Map(state?.folders.map((folder) => [folder.id, folder]))
  for (let current: string | null | undefined = folderId; current; current = byId.get(current)?.parentId) {
    if (current === ancestorId) return true
  }
  return false
}

export async function createSidebarFolder(name: string, parentId?: string): Promise<FileNode | undefined> {
  const id = crypto.randomUUID()
  const parent = parentId ?? readState()?.chatsFolderId
  useFolderExpansion.getState().setExpanded(id, true)
  if (parent) useFolderExpansion.getState().setExpanded(parent, true)
  return mutate(
    parent ? () => writeState((state) => ({ ...state, folders: [...state.folders, { id, parentId: parent, name, systemRole: null }] })) : null,
    () => apiRequest<FileNode>('/api/sidebar/folders', { method: 'POST', body: { id, parentId, name } }),
  )
}

/** Renames a folder, file, or shortcut. */
export function renameSidebarItem(id: string, name: string): Promise<FileNode | undefined> {
  const rename = (item: FileNode) => item.id === id ? { ...item, name } : item
  return mutate(() => {
    writeState((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, name } : folder) }))
    writeItems((items) => items.map(rename))
    writePinned((items) => items.map(rename))
  }, () => apiRequest<FileNode>(`/api/sidebar/items/${id}`, { method: 'PATCH', body: { name } }), name)
}

/**
 * Changes files' and folders' color or icon (null puts back their kind's own) wherever the sidebar
 * and Files show them, shortcuts to them included.
 */
export function setItemAppearance(ids: readonly string[], appearance: { color?: FileColor | null; icon?: FileIcon | null }): Promise<unknown> {
  const changed = new Set(ids)
  const restyle = (item: FileNode): FileNode => {
    if (changed.has(item.id)) return { ...item, ...appearance }
    if (item.kind === 'shortcut' && item.target && changed.has(item.target.id)) return { ...item, target: { ...item.target, ...appearance } }
    return item
  }
  return mutate(() => {
    writeItems((items) => items.map(restyle))
    writePinned((items) => items.map(restyle))
    writeListings(restyle)
  }, () => Promise.all(ids.map((id) => apiRequest<FileNode>(`/api/sidebar/items/${id}`, { method: 'PATCH', body: appearance }))))
}

/**
 * Moves Files items (folders, files, shortcuts) into a folder, or (null) to the top of the sidebar.
 * Pinned ones stay pinned unless `unpin` takes them out of the pinned list, as dragging them does.
 */
function moveSidebarItems(ids: string[], parentId: string | null, { unpin = false } = {}): Promise<unknown> {
  if (parentId) useFolderExpansion.getState().setExpanded(parentId, true)
  return mutate(() => {
    writeState((state) => ({
      ...state,
      folders: state.folders.map((folder) => ids.includes(folder.id) ? { ...folder, parentId: parentId ?? state.chatsFolderId } : folder),
    }))
    writeItems((items) => items.filter((item) => !ids.includes(item.id)))
    if (unpin) writePinned((items) => items.filter((item) => !ids.includes(item.id)))
  }, () => apiRequest('/api/sidebar/move', { method: 'POST', body: { ids, parentId, ...unpin ? { unpin } : {} } }))
}

/**
 * Puts `ids` in this order in `folderId`, chats and Files items alike; anything listed from
 * another folder (or the pinned list) moves in. The rest of the folder keeps its place.
 * `incoming` are items arriving from outside the sidebar (dragged from Files), shown at once.
 */
export async function orderSidebarItems(folderId: string, ids: string[], incoming: readonly FileNode[] = []): Promise<void> {
  const chatsFolderId = readState()?.chatsFolderId
  const position = new Map(ids.map((id, index) => [id, index]))
  const userId = useAuth.getState().user?.id
  useFolderExpansion.getState().setExpanded(folderId, true)
  await mutate(() => {
    useChat.setState((state) => ({
      chats: state.chats.map((chat) => {
        const sortOrder = position.get(chat.id)
        return sortOrder === undefined ? chat : { ...chat, pinned: false, folderId: folderId === chatsFolderId ? null : folderId, inFilesRoot: false, sortOrder }
      }),
    }))
    // Items listed from other folders leave those listings and join this one.
    const moving = new Map<string, FileNode>()
    for (const [, items] of queryClient.getQueriesData<FileNode[]>({ queryKey: ['folders', userId, 'items'] })) {
      for (const item of items ?? []) if (position.has(item.id)) moving.set(item.id, item)
    }
    for (const item of [...readPinned(), ...incoming]) if (position.has(item.id) && item.kind !== 'chat' && !moving.has(item.id)) moving.set(item.id, item)
    writeItems((items) => items.filter((item) => !moving.has(item.id)))
    writePinned((items) => items.filter((item) => !moving.has(item.id)))
    queryClient.setQueryData<FileNode[]>(sidebarItemsKey(userId, folderId), (items) => items && [
      ...items,
      ...[...moving.values()].map((item) => ({ ...item, parentId: folderId, pinned: false, sortOrder: position.get(item.id)! })),
    ])
    writeState((state) => ({
      ...state,
      folders: state.folders.map((folder) => moving.has(folder.id) ? { ...folder, parentId: folderId } : folder),
    }))
  }, () => apiRequest('/api/sidebar/order', { method: 'PUT', body: { parentId: folderId === chatsFolderId ? null : folderId, ids } }))
}

/** Where the pinned list ends: after the pinned chats and Files items. */
function pinnedEnd(): number {
  return useChat.getState().chats.reduce((max, chat) => chat.pinned ? Math.max(max, chat.sortOrder) : max, pinnedItemsCeiling()) + 1
}

/**
 * Pins chats and Files items after those already pinned, in this order, or unpins them, each back
 * to the top of its folder. Either way they stay where they are in Files. `nodes` are Files items
 * among them that the sidebar may not have loaded (e.g. from Files), shown at once.
 */
export function pinSidebarItems(ids: readonly string[], pinned: boolean, nodes: readonly FileNode[] = []): Promise<unknown> {
  const userId = useAuth.getState().user?.id
  const chatsFolderId = readState()?.chatsFolderId
  const listed = new Set(ids)
  return mutate(() => {
    const chats = new Map(useChat.getState().chats.map((chat) => [chat.id, chat]))
    const pinnedIds = new Set(readPinned().map((item) => item.id))
    if (pinned) {
      let next = pinnedEnd()
      const order = new Map(ids.filter((id) => !(chats.get(id)?.pinned ?? pinnedIds.has(id))).map((id) => [id, next++]))
      useChat.setState((state) => ({
        chats: state.chats.map((chat) => order.has(chat.id) ? { ...chat, pinned: true, sortOrder: order.get(chat.id)! } : chat),
      }))
      const known = new Map([...nodes, ...ids.flatMap((id) => findSidebarItem(id) ?? [])].map((node) => [node.id, node]))
      const added = [...order.keys()].flatMap((id) => {
        const node = known.get(id)
        return node && node.kind !== 'chat' ? [{ ...node, pinned: true, sortOrder: order.get(id)! }] : []
      })
      writePinned((items) => [...items, ...added])
      writeItems((items) => items.filter((item) => !order.has(item.id)))
    } else {
      // Last first, so several unpinned into one folder keep their order at its top.
      for (const id of [...ids].reverse()) {
        const chat = chats.get(id)
        if (chat?.pinned) {
          useChat.setState((state) => ({
            chats: state.chats.map((item) => item.id === id ? { ...item, pinned: false, sortOrder: topOrderIn(state.chats.filter((other) => other.id !== id), chat.folderId) } : item),
          }))
        }
        const node = readPinned().find((item) => item.id === id)
        if (!node?.parentId) continue
        const top = topOrderIn(useChat.getState().chats, node.parentId === chatsFolderId ? null : node.parentId)
        queryClient.setQueryData<FileNode[]>(sidebarItemsKey(userId, node.parentId), (items) => items && [{ ...node, pinned: false, sortOrder: top }, ...items])
      }
      writePinned((items) => items.filter((item) => !listed.has(item.id)))
    }
    writeListings((item) => listed.has(item.id) && item.systemRole !== 'chats' ? { ...item, pinned } : item)
  }, () => apiRequest('/api/sidebar/pin', { method: 'POST', body: { ids, pinned } }))
}

/**
 * Puts the pinned list in this order, chats and Files items alike, pinning anything listed that
 * is not pinned yet (it stays where it is in Files). `incoming` are items arriving from outside
 * the sidebar (dragged from Files), shown at once.
 */
export function orderPinnedItems(ids: string[], incoming: readonly FileNode[] = []): Promise<unknown> {
  const position = new Map(ids.map((id, index) => [id, index]))
  return mutate(() => {
    useChat.setState((state) => ({
      chats: state.chats.map((chat) => position.has(chat.id) ? { ...chat, pinned: true, sortOrder: position.get(chat.id)! } : chat),
    }))
    const pinned = new Map(readPinned().map((item) => [item.id, item]))
    for (const item of [...ids.flatMap((id) => findSidebarItem(id) ?? []), ...incoming]) {
      if (item.kind !== 'chat' && !pinned.has(item.id)) pinned.set(item.id, item)
    }
    writePinned(() => [...pinned.values()].map((item) => position.has(item.id) ? { ...item, pinned: true, sortOrder: position.get(item.id)! } : item))
    writeItems((items) => items.filter((item) => !position.has(item.id)))
    writeListings((item) => position.has(item.id) ? { ...item, pinned: true } : item)
  }, () => apiRequest('/api/sidebar/pinned', { method: 'PUT', body: { ids } }))
}

/** Creates an untitled Markdown file at the top of `folderId` (the Files server picks a free name). */
export function newSidebarFile(folderId: string): Promise<FileNode | undefined> {
  useFolderExpansion.getState().setExpanded(folderId, true)
  return mutate(null, () => createDoc(folderId, `${ui("Untitled")}.md`))
}

export function newSidebarRecording(folderId: string): Promise<FileNode | undefined> {
  useFolderExpansion.getState().setExpanded(folderId, true)
  return mutate(null, () => createRecording(folderId, ui("Untitled recording")))
}

/** Uploads files to the top of `folderId`, one at a time, reporting failures as toasts. */
export async function uploadToSidebar(folderId: string, files: readonly File[]): Promise<void> {
  useFolderExpansion.getState().setExpanded(folderId, true)
  for (const file of files) {
    try {
      await uploadFile(folderId, file)
    } catch (cause) {
      useFileToasts.getState().show({ message: filesErrorMessage(cause, file.name), tone: 'error' })
    }
    await refresh()
  }
}

/**
 * Trashes Files items; chats in a trashed folder return to the unfiled list. Resolves with the ids
 * to restore them by (Files can restore them too).
 */
function trashItems(ids: readonly string[]): Promise<string[] | undefined> {
  const state = readState()
  const removed = new Set([...ids, ...state?.folders.filter((folder) => ids.some((id) => isWithin(state, folder.id, id))).map((folder) => folder.id) ?? []])
  return mutate(() => {
    writeState((current) => ({ ...current, folders: current.folders.filter((folder) => !removed.has(folder.id)) }))
    writeItems((items) => items.filter((item) => !removed.has(item.id)))
    writePinned((items) => items.filter((item) => !removed.has(item.id)))
    useChat.setState((chat) => ({
      chats: chat.chats.map((item) => item.folderId && removed.has(item.folderId) ? { ...item, folderId: null } : item),
    }))
  }, () => apiRequest<{ ids: string[] }>('/api/sidebar/trash', { method: 'POST', body: { ids } }).then((result) => result.ids))
}

/** Moves Files items (folders included) into the Archive folder, unpinning them. */
function archiveFiles(fileIds: string[]): Promise<unknown> {
  return mutate(() => {
    writeState((current) => ({
      ...current,
      folders: current.folders.map((folder) => fileIds.includes(folder.id) ? { ...folder, parentId: current.archiveFolderId } : folder),
    }))
    writeItems((items) => items.filter((item) => !fileIds.includes(item.id)))
    writePinned((items) => items.filter((item) => !fileIds.includes(item.id)))
  }, () => apiRequest('/api/sidebar/archive', { method: 'POST', body: { fileIds } }))
}

/** A folder, file, or shortcut from the pinned list or any sidebar listing loaded so far. */
export function findSidebarItem(id: string): FileNode | undefined {
  const pinned = readPinned().find((candidate) => candidate.id === id)
  if (pinned) return pinned
  for (const [, items] of queryClient.getQueriesData<FileNode[]>({ queryKey: ['folders', useAuth.getState().user?.id, 'items'] })) {
    const item = items?.find((candidate) => candidate.id === id)
    if (item) return item
  }
  return undefined
}

/** Splits selected sidebar ids into chats and Files items. */
function splitSelection(ids: readonly string[]) {
  const chats = new Map(useChat.getState().chats.map((chat) => [chat.id, chat]))
  return { chats: ids.flatMap((id) => chats.get(id) ?? []), itemIds: ids.filter((id) => !chats.has(id)) }
}

/**
 * Moves chats and Files items to the top of a folder, or (null) of the sidebar, keeping their
 * order. Pinned ones stay pinned unless `unpin` takes them out of the pinned list, as dragging
 * them out of it does. The move shows in place, so it needs no toast.
 */
export async function moveSidebarSelection(ids: readonly string[], folderId: string | null, { unpin = false } = {}): Promise<void> {
  const chatsFolderId = readState()?.chatsFolderId ?? null
  const target = folderId === chatsFolderId ? null : folderId
  const { chats, itemIds } = splitSelection(ids)
  const store = useChat.getState()
  const chatRequests: Promise<void>[] = []
  // Each moved chat or item lands on top, so file them last-first.
  for (const chat of [...chats].reverse()) {
    if (unpin && chat.pinned) chatRequests.push(store.unpinChat(chat.id, target))
    else if (chat.folderId !== target || chat.inFilesRoot) chatRequests.push(store.moveToFolder(chat.id, target))
  }
  if (itemIds.length) await moveSidebarItems([...itemIds].reverse(), target, { unpin })
  await Promise.all(chatRequests)
}

/** Moves chats and Files items into the Archive folder, unpinning them, and offers to undo it. */
export async function archiveSidebarSelection(ids: readonly string[], nodes: readonly FileNode[] = []): Promise<void> {
  const archiveFolderId = readState()?.archiveFolderId
  if (!archiveFolderId) return
  const before = placements(ids, nodes)
  const pinnedBefore = pinnedOrder()
  const { chats, itemIds } = splitSelection(ids)
  const chatRequests = chats.map((chat) => useChat.getState().archiveChat(chat.id, archiveFolderId))
  const itemsArchived = itemIds.length ? await archiveFiles(itemIds) : true
  await Promise.all(chatRequests)
  await refresh()
  if (!itemsArchived || !before.length) return
  announce(
    describe(before, (name) => uit`Moved "${name}" to the archive`, (total) => uit`Moved ${total} items to the archive`),
    () => putBack(before, pinnedBefore),
  )
}

/**
 * Trashes chats (to the chat trash, or for good with instant retention) and Files items (to the
 * Files trash), and offers to undo it.
 */
export async function trashSidebarSelection(ids: readonly string[]): Promise<void> {
  const before = placements(ids)
  const { chats, itemIds } = splitSelection(ids)
  const deleted = chats.map((chat) => useChat.getState().deleteChat(chat.id))
  const roots = itemIds.length ? await trashItems(itemIds) : []
  if (!roots || !before.length) return
  // Chats deleted right away cannot come back.
  const forGood = chats.length > 0 && useSettings.getState().trashRetention === 'instant'
  const chatIds = forGood ? [] : chats.map((chat) => chat.id)
  announce(
    forGood
      ? describe(before, (name) => uit`Deleted "${name}"`, (total) => uit`Deleted ${total} items`)
      : describe(before, (name) => uit`Moved "${name}" to the trash`, (total) => uit`Moved ${total} items to the trash`),
    roots.length || chatIds.length ? async () => {
      await Promise.all(deleted)
      try {
        await Promise.all([
          roots.length ? apiRequest('/api/sidebar/restore', { method: 'POST', body: { ids: roots } }) : undefined,
          chatIds.length ? useChat.getState().recoverChats(chatIds) : undefined,
        ])
      } finally {
        await refresh()
      }
    } : undefined,
  )
}

/** Creates a shortcut to a Files item or a chat in `parentId` (null is My files; omitted, the Chats folder). */
export function createShortcut(targetKind: 'file' | 'chat', targetId: string, parentId?: string | null): Promise<FileNode | undefined> {
  if (parentId) useFolderExpansion.getState().setExpanded(parentId, true)
  return mutate(null, () => apiRequest<FileNode>('/api/sidebar/shortcuts', { method: 'POST', body: { targetKind, targetId, parentId } }))
}

/**
 * Asks where something should go, like a file manager's destination dialog. Resolves with the
 * chosen folder, or null when cancelled. The Sidebar renders the dialog.
 */
export interface FolderPickerRequest {
  title: string
  action: string
  initialFolderId: string | null
  excludedIds?: ReadonlySet<string>
  resolve: (folderId: string | null | undefined) => void
}
export const useFolderPicker = create<{ request: FolderPickerRequest | null }>()(() => ({ request: null }))

/** Resolves with the chosen folder (null is My files), or undefined when cancelled. */
export function pickFolder(options: Omit<FolderPickerRequest, 'resolve'>): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    useFolderPicker.getState().request?.resolve(undefined)
    useFolderPicker.setState({ request: { ...options, resolve } })
  })
}

/**
 * "Create shortcut…": choose where the shortcut goes, starting from `from` (the Chats folder by
 * default). Without Files there is nowhere else to browse, so it goes in the Chats folder.
 */
export async function createShortcutInteractively(targetKind: 'file' | 'chat', targetId: string, from?: string | null): Promise<FileNode | undefined> {
  if (!useAuth.getState().filesEnabled) return createShortcut(targetKind, targetId)
  const destination = await pickFolder({
    title: ui("Create shortcut"),
    action: ui("Create here"),
    initialFolderId: from === undefined ? readState()?.chatsFolderId ?? null : from,
  })
  if (destination === undefined) return undefined
  return createShortcut(targetKind, targetId, destination)
}

const EXPANDED_KEY = 'pulpo-folder-expanded'

function loadExpanded(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

/** Which sidebar folders are open, remembered on this device. */
export const useFolderExpansion = create<{
  expanded: Record<string, boolean>
  setExpanded: (id: string, expanded: boolean) => void
}>()((set) => ({
  expanded: loadExpanded(),
  setExpanded: (id, expanded) => set((state) => {
    if (state.expanded[id] === expanded) return state
    const next = { ...state.expanded, [id]: expanded }
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)) } catch { /* the preference is optional */ }
    return { expanded: next }
  }),
}))
