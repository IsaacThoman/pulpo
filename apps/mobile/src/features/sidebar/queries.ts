import type { FileNode, SidebarState } from '@pulpo/contracts'
import { queryOptions, useQueries, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { isNetworkError } from '../../api/client'
import { getValue, pendingOutbox, setValue } from '../../data/database'
import { fetchSidebarItems, fetchSidebarState } from './api'
import type { SidebarUnavailable } from './tree'

/**
 * Sidebar queries live under ['files', namespace], so the `files` and `folders` realtime scopes
 * (and every Files change made here) refresh them. They are kept on the device too: the drawer
 * shows its folders at once on launch, and offline.
 */
export const sidebarKeys = {
  all: (namespace: string) => ['files', namespace, 'sidebar'] as const,
  state: (namespace: string) => ['files', namespace, 'sidebar', 'state'] as const,
  items: (namespace: string, folderId: string) => ['files', namespace, 'sidebar', 'items', folderId] as const,
}

const STATE_KEY = 'sidebar:state'
const itemsKey = (folderId: string) => `sidebar:items:${folderId}`

/** The server's answer (kept as it is), or offline the last one kept on this device. */
async function withDeviceCopy<T>(namespace: string, key: string, fetch: () => Promise<T>): Promise<T> {
  try {
    const value = await fetch()
    void setValue(namespace, key, { value }).catch(() => undefined)
    return value
  } catch (error) {
    if (isNetworkError(error)) {
      const kept = await getValue<{ value: T }>(namespace, key).catch(() => null)
      if (kept) return kept.value
    }
    throw error
  }
}

interface PendingFolder {
  id: string
  /** As sent: null is the top of the sidebar. */
  parentId: string | null
  name: string
  createdAt: number
}

/**
 * Folders created offline that the outbox still has to send. They are listed until the server
 * has them (or refuses them, when the outbox drops them), across refetches and relaunches.
 */
export async function pendingSidebarFolders(namespace: string): Promise<PendingFolder[]> {
  const rows = await pendingOutbox(namespace).catch(() => [])
  return rows.flatMap((row) => {
    if (row.method !== 'POST' || row.path !== '/api/sidebar/folders' || !row.body) return []
    try {
      const body = JSON.parse(row.body) as { id?: unknown; parentId?: unknown; name?: unknown }
      if (typeof body.id !== 'string' || typeof body.name !== 'string') return []
      return [{ id: body.id, parentId: typeof body.parentId === 'string' ? body.parentId : null, name: body.name, createdAt: row.createdAt }]
    } catch {
      return []
    }
  })
}

function withPendingState(state: SidebarState | null, pending: readonly PendingFolder[]): SidebarState | null {
  const missing = state ? pending.filter((folder) => !state.folders.some((known) => known.id === folder.id)) : []
  if (!state || !missing.length) return state
  return {
    ...state,
    folders: [...state.folders, ...missing.map((folder) => ({ id: folder.id, parentId: folder.parentId ?? state.chatsFolderId, name: folder.name, systemRole: null }))],
  }
}

/** Adds this folder's pending folders at its top, as the server will put them. `root`: the Chats folder. */
function withPendingItems(items: FileNode[], folderId: string, root: boolean, pending: readonly PendingFolder[]): FileNode[] {
  const missing = pending.filter((folder) => (folder.parentId === null ? root : folder.parentId === folderId) && !items.some((item) => item.id === folder.id))
  if (!missing.length) return items
  const top = items.reduce((min, item) => Math.min(min, item.sortOrder ?? 0), 0)
  return [
    ...missing.map((folder, index): FileNode => {
      const at = new Date(folder.createdAt).toISOString()
      return {
        id: folder.id, parentId: folderId, kind: 'folder', name: folder.name, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
        trashedAt: null, createdAt: at, updatedAt: at, systemRole: null, sortOrder: top - missing.length + index, pinned: false,
      }
    }),
    ...items,
  ]
}

/** The sidebar state; null on a server without the sidebar, whose folders come from /api/folders. */
export function sidebarStateQuery(namespace: string) {
  return queryOptions({
    queryKey: sidebarKeys.state(namespace),
    queryFn: async ({ signal }): Promise<SidebarState | null> => {
      const state = await withDeviceCopy(namespace, STATE_KEY, () => fetchSidebarState(signal))
      return withPendingState(state, await pendingSidebarFolders(namespace))
    },
    staleTime: 30_000,
  })
}

/** A folder's items; `root` says it is the Chats folder, where folders created offline at the top go. */
export function sidebarItemsQuery(namespace: string, folderId: string, root = false) {
  return queryOptions({
    queryKey: sidebarKeys.items(namespace, folderId),
    queryFn: async ({ signal }): Promise<FileNode[]> => {
      const items = await withDeviceCopy(namespace, itemsKey(folderId), () => fetchSidebarItems(folderId, signal))
      return withPendingItems(items, folderId, root, await pendingSidebarFolders(namespace))
    },
    staleTime: 30_000,
  })
}

/** Shows the copy kept on the device until the server answers, unless it already has. */
function useDeviceCopies(client: QueryClient, namespace: string, entries: ReadonlyArray<{ key: QueryKey; deviceKey: string }>) {
  useEffect(() => {
    if (!namespace) return
    let cancelled = false
    for (const entry of entries) {
      if (client.getQueryData(entry.key) !== undefined) continue
      void getValue<{ value: unknown }>(namespace, entry.deviceKey).then((kept) => {
        if (cancelled || !kept || client.getQueryData(entry.key) !== undefined) return
        // Stale from the start, so the fetch underway (or the next mount) still replaces it.
        client.setQueryData(entry.key, kept.value, { updatedAt: 0 })
      }).catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [client, entries, namespace])
}

type QueryOutcome = { data?: unknown; isError: boolean; fetchStatus: string }

/** Why something is missing: offline with no copy on the device, or refused; null while it loads. */
export function sidebarUnavailable(result: QueryOutcome): SidebarUnavailable | null {
  if (result.data !== undefined) return null
  if (result.isError) return 'failed'
  return result.fetchStatus === 'paused' ? 'offline' : null
}

/** The sidebar state (undefined until known, null on servers without the sidebar), and why it is missing. */
export function useSidebarState(namespace: string): { state: SidebarState | null | undefined; unavailable: SidebarUnavailable | null } {
  const client = useQueryClient()
  useDeviceCopies(client, namespace, useMemo(() => namespace ? [{ key: sidebarKeys.state(namespace), deviceKey: STATE_KEY }] : [], [namespace]))
  const query = useQuery({ ...sidebarStateQuery(namespace), enabled: Boolean(namespace) })
  return { state: query.data, unavailable: sidebarUnavailable(query) }
}

export interface SidebarListings {
  /** Loaded listings; a folder missing here is still loading, or unavailable. */
  listings: ReadonlyMap<string, FileNode[]>
  unavailable: ReadonlyMap<string, SidebarUnavailable>
}

function sameEntries<V>(left: ReadonlyMap<string, V>, right: ReadonlyMap<string, V>): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value)
}

/**
 * The listings of these folders (a stable array). The result only changes when a listing (or
 * why one is missing) does, not on every refetch, so the drawer is not rebuilt for nothing.
 */
export function useSidebarListings(namespace: string, folderIds: readonly string[], rootId?: string): SidebarListings {
  const client = useQueryClient()
  const entries = useMemo(() => namespace ? folderIds.map((id) => ({ key: sidebarKeys.items(namespace, id), deviceKey: itemsKey(id) })) : [], [folderIds, namespace])
  useDeviceCopies(client, namespace, entries)
  const previous = useRef<SidebarListings | null>(null)
  const combine = useCallback((results: Array<QueryOutcome & { data?: FileNode[] }>): SidebarListings => {
    const listings = new Map<string, FileNode[]>()
    const unavailable = new Map<string, SidebarUnavailable>()
    folderIds.forEach((id, index) => {
      const result = results[index]
      if (result?.data) listings.set(id, result.data)
      const missing = result ? sidebarUnavailable(result) : null
      if (missing) unavailable.set(id, missing)
    })
    const last = previous.current
    if (last && sameEntries(last.listings, listings) && sameEntries(last.unavailable, unavailable)) return last
    previous.current = { listings, unavailable }
    return previous.current
  }, [folderIds])
  return useQueries({ queries: folderIds.map((id) => ({ ...sidebarItemsQuery(namespace, id, id === rootId), enabled: Boolean(namespace) })), combine })
}
