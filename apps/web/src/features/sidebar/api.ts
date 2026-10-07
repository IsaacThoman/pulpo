import { useQuery } from '@tanstack/react-query'
import type { FileNode, SidebarFolder, SidebarShortcut, SidebarShortcutTarget, SidebarState } from '@pulpo/contracts'
import { create } from 'zustand'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { useChat } from '@/stores/chat'

/*
 * The sidebar shows folders from Files: the Chats folder's folders, Archive, and folders reached
 * through shortcuts. Everything here lives under ['folders', userId], which the 'folders' and
 * 'files' realtime scopes refresh.
 */
// 'sidebar' keeps the persisted cache apart from the old chat folder list stored at ['folders', userId].
export const sidebarQueryKey = (userId: string | undefined) => ['folders', userId, 'sidebar'] as const
export const sidebarFolderFilesKey = (userId: string | undefined, folderId: string) => ['folders', userId, 'files', folderId] as const

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

/** The Files items (not folders or chats) in an expanded folder. */
export function useSidebarFolderFiles(folderId: string, enabled: boolean) {
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  return useQuery({
    queryKey: sidebarFolderFilesKey(userId, folderId),
    queryFn: ({ signal }) => apiRequest<{ items: FileNode[] }>(`/api/sidebar/folders/${folderId}/files`, { signal }).then((result) => result.items),
    enabled: Boolean(userId && enabled && filesEnabled),
    refetchOnWindowFocus: false,
  })
}

/** Drop target the Files browser's pointer drag recognizes for adding sidebar shortcuts. */
export const SHORTCUTS_DROP_TARGET = 'sidebar-shortcuts'

const currentKey = () => sidebarQueryKey(useAuth.getState().user?.id)
const readState = () => queryClient.getQueryData<SidebarState>(currentKey())
const writeState = (update: (state: SidebarState) => SidebarState) => {
  queryClient.setQueryData<SidebarState>(currentKey(), (state) => state && update(state))
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

export function renameSidebarFolder(id: string, name: string): Promise<FileNode> {
  return mutate(
    () => writeState((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, name } : folder) })),
    () => apiRequest<FileNode>(`/api/sidebar/folders/${id}`, { method: 'PATCH', body: { name } }),
  )
}

/** Moves a folder into another one, or (null) to the top of the sidebar. */
export function moveSidebarFolder(id: string, parentId: string | null): Promise<FileNode> {
  const state = readState()
  if (parentId) useFolderExpansion.getState().setExpanded(parentId, true)
  return mutate(
    state ? () => writeState((current) => ({
      ...current,
      folders: current.folders.map((folder) => folder.id === id ? { ...folder, parentId: parentId ?? current.chatsFolderId } : folder),
    })) : null,
    () => apiRequest<FileNode>(`/api/sidebar/folders/${id}`, { method: 'PATCH', body: { parentId } }),
  )
}

/** Trashes a folder; chats in it return to the unfiled list. Files can restore it. */
export function trashSidebarFolder(id: string): Promise<void> {
  const state = readState()
  const removed = new Set(state?.folders.filter((folder) => isWithin(state, folder.id, id)).map((folder) => folder.id))
  return mutate(() => {
    writeState((current) => ({ ...current, folders: current.folders.filter((folder) => !removed.has(folder.id)) }))
    useChat.setState((chat) => ({
      chats: chat.chats.map((item) => item.folderId && removed.has(item.folderId) ? { ...item, folderId: null } : item),
    }))
  }, () => apiRequest<void>(`/api/sidebar/folders/${id}`, { method: 'DELETE' }))
}

/** Moves Files items (folders included) into the Archive folder. Chats use `useChat().archiveChat`. */
export function archiveFiles(fileIds: string[]): Promise<unknown> {
  const state = readState()
  return mutate(
    state ? () => writeState((current) => ({
      ...current,
      folders: current.folders.map((folder) => fileIds.includes(folder.id) ? { ...folder, parentId: current.archiveFolderId } : folder),
    })) : null,
    () => apiRequest('/api/sidebar/archive', { method: 'POST', body: { fileIds } }),
  )
}

export function archiveChat(chatId: string): void {
  const archiveFolderId = readState()?.archiveFolderId
  if (!archiveFolderId) return
  useChat.getState().archiveChat(chatId, archiveFolderId)
  void refresh()
}

export function shortcutFor(state: SidebarState | undefined, targetId: string): SidebarShortcut | undefined {
  return state?.shortcuts.find((shortcut) => shortcut.targetId === targetId)
}

export function addShortcut(targetKind: SidebarShortcutTarget, targetId: string): Promise<unknown> {
  return mutate(null, () => apiRequest('/api/sidebar/shortcuts', { method: 'POST', body: { targetKind, targetId } }))
}

export function removeShortcut(id: string): Promise<void> {
  return mutate(
    () => writeState((state) => ({ ...state, shortcuts: state.shortcuts.filter((shortcut) => shortcut.id !== id) })),
    () => apiRequest<void>(`/api/sidebar/shortcuts/${id}`, { method: 'DELETE' }),
  )
}

export function reorderShortcuts(ids: string[]): Promise<unknown> {
  return mutate(
    () => writeState((state) => ({
      ...state,
      shortcuts: ids.map((id) => state.shortcuts.find((shortcut) => shortcut.id === id)).filter((shortcut): shortcut is SidebarShortcut => Boolean(shortcut)),
    })),
    () => apiRequest('/api/sidebar/shortcuts/order', { method: 'PUT', body: { ids } }),
  )
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
