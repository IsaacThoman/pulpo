import type { FileNode, SidebarState } from '@pulpo/contracts'
import { queryOptions, useQueries, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { isNetworkError } from '../../api/client'
import { getValue, setValue } from '../../data/database'
import { fetchSidebarItems, fetchSidebarState } from './api'

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

/** The server's answer, or offline the last one kept on this device. */
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

/** The sidebar state; null on a server without the sidebar, whose folders come from /api/folders. */
export function sidebarStateQuery(namespace: string) {
  return queryOptions({
    queryKey: sidebarKeys.state(namespace),
    queryFn: ({ signal }): Promise<SidebarState | null> => withDeviceCopy(namespace, STATE_KEY, () => fetchSidebarState(signal)),
    staleTime: 30_000,
  })
}

export function sidebarItemsQuery(namespace: string, folderId: string) {
  return queryOptions({
    queryKey: sidebarKeys.items(namespace, folderId),
    queryFn: ({ signal }): Promise<FileNode[]> => withDeviceCopy(namespace, itemsKey(folderId), () => fetchSidebarItems(folderId, signal)),
    staleTime: 30_000,
  })
}

/** Keeps what the drawer shows now for the next launch or a refetch offline (after changes queued offline). */
export function keepSidebarOnDevice(client: QueryClient, namespace: string): Promise<unknown> {
  const writes: Promise<unknown>[] = []
  const state = client.getQueryData<SidebarState | null>(sidebarKeys.state(namespace))
  if (state !== undefined) writes.push(setValue(namespace, STATE_KEY, { value: state }))
  for (const [key, items] of client.getQueriesData<FileNode[]>({ queryKey: [...sidebarKeys.all(namespace), 'items'] })) {
    if (items) writes.push(setValue(namespace, itemsKey(String(key[4])), { value: items }))
  }
  return Promise.all(writes).catch(() => undefined)
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

/** The sidebar state: undefined until known, null on servers without the sidebar. */
export function useSidebarState(namespace: string): SidebarState | null | undefined {
  const client = useQueryClient()
  useDeviceCopies(client, namespace, useMemo(() => namespace ? [{ key: sidebarKeys.state(namespace), deviceKey: STATE_KEY }] : [], [namespace]))
  return useQuery({ ...sidebarStateQuery(namespace), enabled: Boolean(namespace) }).data
}

/**
 * The listings of these folders (a stable array), as far as loaded; a folder missing from the map
 * is still loading. The map only changes when a listing does.
 */
export function useSidebarListings(namespace: string, folderIds: readonly string[]): ReadonlyMap<string, FileNode[]> {
  const client = useQueryClient()
  const entries = useMemo(() => namespace ? folderIds.map((id) => ({ key: sidebarKeys.items(namespace, id), deviceKey: itemsKey(id) })) : [], [folderIds, namespace])
  useDeviceCopies(client, namespace, entries)
  const combine = useCallback((results: Array<{ data?: FileNode[] }>) => (
    new Map(folderIds.flatMap((id, index) => results[index]?.data ? [[id, results[index]!.data!] as const] : []))
  ), [folderIds])
  return useQueries({ queries: folderIds.map((id) => ({ ...sidebarItemsQuery(namespace, id), enabled: Boolean(namespace) })), combine })
}
