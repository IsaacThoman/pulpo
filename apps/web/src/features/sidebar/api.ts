import { useQuery } from '@tanstack/react-query'
import type { FileNode, SidebarFolder, SidebarState } from '@pulpo/contracts'
import { create } from 'zustand'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { useChat } from '@/stores/chat'
import { sidebarItemsKey, sidebarQueryKey } from './cache'
import { ui } from '@/i18n/ui'

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
const refresh = () => Promise.all([
  queryClient.invalidateQueries({ queryKey: ['folders', useAuth.getState().user?.id] }),
  queryClient.invalidateQueries({ queryKey: ['files', useAuth.getState().user?.id] }),
])

/** Runs a sidebar change shown at once, then confirmed (or undone) by refetching. */
async function mutate<T>(optimistic: (() => void) | null, request: () => Promise<T>): Promise<T> {
  optimistic?.()
  try {
    return await request()
  } finally {
    await refresh()
  }
}

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

export async function createSidebarFolder(name: string, parentId?: string): Promise<FileNode> {
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
export function renameSidebarItem(id: string, name: string): Promise<FileNode> {
  return mutate(() => {
    writeState((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, name } : folder) }))
    writeItems((items) => items.map((item) => item.id === id ? { ...item, name } : item))
  }, () => apiRequest<FileNode>(`/api/sidebar/items/${id}`, { method: 'PATCH', body: { name } }))
}

/** Moves Files items (folders, files, shortcuts) into a folder, or (null) to the top of the sidebar. */
export function moveSidebarItems(ids: string[], parentId: string | null): Promise<unknown> {
  if (parentId) useFolderExpansion.getState().setExpanded(parentId, true)
  return mutate(() => {
    writeState((state) => ({
      ...state,
      folders: state.folders.map((folder) => ids.includes(folder.id) ? { ...folder, parentId: parentId ?? state.chatsFolderId } : folder),
    }))
    writeItems((items) => items.filter((item) => !ids.includes(item.id)))
  }, () => apiRequest('/api/sidebar/move', { method: 'POST', body: { ids, parentId } }))
}

/**
 * Puts `ids` in this order in `folderId`, chats and Files items alike; anything listed from
 * another folder (or the pinned chats) moves in. The rest of the folder keeps its place.
 */
export function orderSidebarItems(folderId: string, ids: string[]): Promise<unknown> {
  const chatsFolderId = readState()?.chatsFolderId
  const position = new Map(ids.map((id, index) => [id, index]))
  const userId = useAuth.getState().user?.id
  useFolderExpansion.getState().setExpanded(folderId, true)
  return mutate(() => {
    useChat.setState((state) => ({
      chats: state.chats.map((chat) => {
        const sortOrder = position.get(chat.id)
        return sortOrder === undefined ? chat : { ...chat, pinned: false, folderId: folderId === chatsFolderId ? null : folderId, sortOrder }
      }),
    }))
    // Items listed from other folders leave those listings and join this one.
    const moving = new Map<string, FileNode>()
    for (const [, items] of queryClient.getQueriesData<FileNode[]>({ queryKey: ['folders', userId, 'items'] })) {
      for (const item of items ?? []) if (position.has(item.id)) moving.set(item.id, item)
    }
    writeItems((items) => items.filter((item) => !moving.has(item.id)))
    queryClient.setQueryData<FileNode[]>(sidebarItemsKey(userId, folderId), (items) => items && [
      ...items,
      ...[...moving.values()].map((item) => ({ ...item, parentId: folderId, sortOrder: position.get(item.id)! })),
    ])
    writeState((state) => ({
      ...state,
      folders: state.folders.map((folder) => moving.has(folder.id) ? { ...folder, parentId: folderId } : folder),
    }))
  }, () => apiRequest('/api/sidebar/order', { method: 'PUT', body: { parentId: folderId === chatsFolderId ? null : folderId, ids } }))
}

/** Trashes a Files item; chats in a trashed folder return to the unfiled list. Files can restore it. */
export function trashSidebarItem(id: string): Promise<void> {
  const state = readState()
  const removed = new Set([id, ...state?.folders.filter((folder) => isWithin(state, folder.id, id)).map((folder) => folder.id) ?? []])
  return mutate(() => {
    writeState((current) => ({ ...current, folders: current.folders.filter((folder) => !removed.has(folder.id)) }))
    writeItems((items) => items.filter((item) => !removed.has(item.id)))
    useChat.setState((chat) => ({
      chats: chat.chats.map((item) => item.folderId && removed.has(item.folderId) ? { ...item, folderId: null } : item),
    }))
  }, () => apiRequest<void>(`/api/sidebar/items/${id}`, { method: 'DELETE' }))
}

/** Moves Files items (folders included) into the Archive folder. Chats use `archiveChat`. */
export function archiveFiles(fileIds: string[]): Promise<unknown> {
  return mutate(() => {
    writeState((current) => ({
      ...current,
      folders: current.folders.map((folder) => fileIds.includes(folder.id) ? { ...folder, parentId: current.archiveFolderId } : folder),
    }))
    writeItems((items) => items.filter((item) => !fileIds.includes(item.id)))
  }, () => apiRequest('/api/sidebar/archive', { method: 'POST', body: { fileIds } }))
}

export function archiveChat(chatId: string): void {
  const archiveFolderId = readState()?.archiveFolderId
  if (!archiveFolderId) return
  useChat.getState().archiveChat(chatId, archiveFolderId)
  void refresh()
}

/** Creates a shortcut to a Files item or a chat in `parentId` (null is My files; omitted, the Chats folder). */
export function createShortcut(targetKind: 'file' | 'chat', targetId: string, parentId?: string | null): Promise<FileNode> {
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
