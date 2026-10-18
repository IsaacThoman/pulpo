import { fileNameError, normalizeFileName, type FileNode, type SidebarState } from '@pulpo/contracts'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { randomUUID } from 'expo-crypto'
import { useMemo } from 'react'
import { isNetworkError } from '../../api/client'
import { queueOfflineMutation } from '../../data/mutations'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { topChatSortOrder, visibleHistoryChats } from '../chat/history'
import { moveFileNodes, pinItems } from '../files/api'
import { fileNameErrorMessage, filesErrorMessage } from '../files/display'
import { refreshFiles } from '../files/operations'
import { useFilesToasts, type FilesToast } from '../files/toasts'
import { archiveSidebarItems, createSidebarFolder, moveSidebarItems, orderPinnedItems, renameSidebarItem, restoreSidebarItems, trashSidebarItems } from './api'
import { useSidebarExpansion } from './expansion'
import { sidebarKeys } from './queries'
import { isWithin, pinnedItemsCeiling } from './tree'

/** A chat or a Files item, as the drawer acts on it. */
export type SidebarTarget =
  /** `inFilesRoot`: at the top of My files, outside the sidebar (found by search, or pinned). */
  | { kind: 'chat'; id: string; name: string; folderId: string | null; inFilesRoot: boolean; pinned: boolean }
  | { kind: 'node'; node: FileNode }

/** The drawer's copies of the sidebar in the query cache, changed at once by the actions below. */
function sidebarCache(client: QueryClient, namespace: string) {
  const stateKey = sidebarKeys.state(namespace)
  /** Undefined until loaded; null from a server without the sidebar. */
  const readState = () => client.getQueryData<SidebarState | null>(stateKey)
  const writeState = (update: (state: SidebarState) => SidebarState) => {
    client.setQueryData<SidebarState | null>(stateKey, (state) => state ? update(state) : state)
  }
  const readListing = (folderId: string) => client.getQueryData<FileNode[]>(sidebarKeys.items(namespace, folderId))
  const writeListing = (folderId: string, update: (items: FileNode[]) => FileNode[]) => {
    client.setQueryData<FileNode[]>(sidebarKeys.items(namespace, folderId), (items) => items && update(items))
  }
  /** Applies a change to every loaded folder listing. */
  const writeListings = (update: (items: FileNode[]) => FileNode[]) => {
    for (const [key, items] of client.getQueriesData<FileNode[]>({ queryKey: [...sidebarKeys.all(namespace), 'items'] })) {
      if (items) client.setQueryData(key, update(items))
    }
  }
  const writePinned = (update: (items: FileNode[]) => FileNode[]) => writeState((state) => ({ ...state, pinnedItems: update(state.pinnedItems ?? []) }))
  return { readState, writeState, readListing, writeListing, writeListings, writePinned }
}

/** The lowest sort order among the Files items shown in a folder, or (null) at the top of the sidebar. */
export function sidebarItemsFloor(client: QueryClient, namespace: string, folderId: string | null): number | undefined {
  const cache = sidebarCache(client, namespace)
  const id = folderId ?? cache.readState()?.chatsFolderId
  const items = id ? cache.readListing(id) : undefined
  return items?.length ? Math.min(...items.map((item) => item.sortOrder ?? 0)) : undefined
}

/** The sort order at the top of a folder (null: the top of the sidebar), above its chats and Files items. */
function topOrderIn(client: QueryClient, namespace: string, folderId: string | null): number {
  return topChatSortOrder(visibleHistoryChats(usePrototypeStore.getState().chats), folderId, { floor: sidebarItemsFloor(client, namespace, folderId) })
}

/** The pinned list, chats and Files items, in order. */
function pinnedOrder(sidebar: SidebarState | null | undefined): string[] {
  return [
    ...visibleHistoryChats(usePrototypeStore.getState().chats).filter((chat) => chat.pinned).map((chat) => ({ id: chat.id, sortOrder: chat.sortOrder, createdAt: chat.createdAt })),
    ...(sidebar?.pinnedItems ?? []).map((item) => ({ id: item.id, sortOrder: item.sortOrder ?? 0, createdAt: Date.parse(item.createdAt) })),
  ].sort((left, right) => left.sortOrder - right.sortOrder || right.createdAt - left.createdAt).map((entry) => entry.id)
}

const nameOf = (target: SidebarTarget) => target.kind === 'chat' ? target.name : target.node.name

type ShowToast = (toast: Omit<FilesToast, 'id' | 'tone'> & { tone?: FilesToast['tone'] }) => void

/**
 * The drawer's actions on folders, files, and shortcuts (and on chats where the sidebar differs
 * from the chat menu), as the web sidebar has them (apps/web/src/features/sidebar/api.ts): each
 * shows at once, then is confirmed or put back by refetching; failures show in a toast. Creating
 * a folder is kept for later offline; the rest need a connection, as in Files.
 */
export function sidebarOperations(client: QueryClient, namespace: string, showToast: ShowToast) {
  const cache = sidebarCache(client, namespace)
  // An action that finishes after switching accounts says nothing: its Undo would act on the other one.
  const show: ShowToast = (toast) => {
    if (usePrototypeStore.getState().productionNamespace === namespace) showToast(toast)
  }
  const expand = (key: string) => useSidebarExpansion.getState().setExpanded(key, true)
  const refresh = (chats = false) => refreshFiles(client, namespace, chats)
  const fail = (cause: unknown, name?: string) => show({ message: filesErrorMessage(cause, name), tone: 'error' })
  /** The sidebar's own id for a folder: null for the Chats folder, which is the top of the sidebar. */
  const inSidebar = (folderId: string | null) => folderId === cache.readState()?.chatsFolderId ? null : folderId

  /** Shows a change at once, sends it, and refetches either way. Resolves null when it failed. */
  const mutate = async <T>(optimistic: () => void, request: () => Promise<T>, options: { name?: string; chats?: boolean } = {}): Promise<{ value: T } | null> => {
    await client.cancelQueries({ queryKey: sidebarKeys.all(namespace) })
    optimistic()
    try {
      return { value: await request() }
    } catch (cause) {
      fail(cause, options.name)
      return null
    } finally {
      await refresh(options.chats)
    }
  }

  /**
   * Where a moved or unpinned chat goes. Servers without the sidebar keep a chat's old position
   * unless told the new one, so it is sent whenever the sidebar isn't known to be there.
   */
  const placement = (folderId: string | null) => ({ floor: sidebarItemsFloor(client, namespace, folderId), sendSortOrder: !cache.readState() })

  /**
   * A name as the server will keep it, or null (saying why) when it can't be used. Checked before
   * anything shows or is kept for later, so a refused name never comes and goes offline.
   */
  const usableName = (name: string): string | null => {
    const normalized = normalizeFileName(name)
    const error = fileNameError(normalized)
    if (!error) return normalized
    show({ message: fileNameErrorMessage(error), tone: 'error' })
    return null
  }

  /**
   * Puts something archived back where it was (null: the top of My files, where only Files
   * moves things), and back in the pinned list in its old place. A chat moves back here at once.
   */
  const putBack = async (id: string, parentId: string | null, wasPinned: boolean, pinnedBefore: readonly string[]) => {
    const chatsFolderId = cache.readState()?.chatsFolderId
    usePrototypeStore.setState((state) => ({
      chats: state.chats.map((chat) => chat.id === id
        ? { ...chat, folderId: parentId === chatsFolderId ? null : parentId, inFilesRoot: parentId === null, pinned: chat.pinned || wasPinned }
        : chat),
    }))
    try {
      if (parentId === null) await moveFileNodes([{ id, parentId: null }])
      else await moveSidebarItems([id], inSidebar(parentId))
      if (wasPinned) {
        const pinnedNow = new Set(pinnedOrder(cache.readState()))
        await orderPinnedItems(pinnedBefore.filter((other) => other === id || pinnedNow.has(other)))
      }
    } catch (cause) {
      fail(cause)
    } finally {
      await refresh(true)
    }
  }

  return {
    /** Creates a folder at the top of `parentId` (null: of the sidebar), offline too. */
    async createFolder(parentId: string | null, name: string): Promise<FileNode | undefined> {
      const state = cache.readState()
      if (!state) return undefined
      const trimmed = usableName(name)
      if (!trimmed) return undefined
      const target = inSidebar(parentId)
      const parent = target ?? state.chatsFolderId
      const id = randomUUID()
      const at = new Date().toISOString()
      const node: FileNode = {
        id, parentId: parent, kind: 'folder', name: trimmed, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
        trashedAt: null, createdAt: at, updatedAt: at, systemRole: null, sortOrder: topOrderIn(client, namespace, target), pinned: false,
      }
      if (target) expand(target)
      await client.cancelQueries({ queryKey: sidebarKeys.all(namespace) })
      cache.writeState((current) => ({ ...current, folders: [...current.folders, { id, parentId: parent, name: trimmed, systemRole: null }] }))
      cache.writeListing(parent, (items) => [node, ...items])
      // Opened before the server has it (offline), it is empty rather than loading.
      client.setQueryData<FileNode[]>(sidebarKeys.items(namespace, id), [])
      const body = { id, parentId: target, name: trimmed }
      try {
        await createSidebarFolder(body)
      } catch (cause) {
        if (isNetworkError(cause)) {
          // The client-chosen id makes the replay create it once. Until then the sidebar's
          // queries list it from the outbox, even after a relaunch or a refetch.
          await queueOfflineMutation({ namespace, entityKey: `folder:${id}`, method: 'POST', path: '/api/sidebar/folders', body })
          return node
        }
        fail(cause, trimmed)
        await refresh()
        return undefined
      }
      await refresh()
      return node
    },

    /** Renames a folder, file, or shortcut; the server numbers a name in use. */
    async rename(node: FileNode, name: string): Promise<void> {
      if (normalizeFileName(name) === node.name) return
      const next = usableName(name)
      if (!next) return
      const rename = (item: FileNode) => item.id === node.id ? { ...item, name: next } : item
      await mutate(() => {
        cache.writeState((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === node.id ? { ...folder, name: next } : folder) }))
        cache.writeListings((items) => items.map(rename))
        cache.writePinned((items) => items.map(rename))
      }, () => renameSidebarItem(node.id, next), { name: next })
    },

    /**
     * Moves a chat or Files item to the top of a folder, or (null) of the sidebar. Pinned ones
     * stay pinned. The move shows in place, so it needs no toast (as on the web).
     */
    async move(target: SidebarTarget, folderId: string | null): Promise<void> {
      const destination = inSidebar(folderId)
      if (destination) expand(destination)
      if (target.kind === 'chat') {
        if (target.folderId === destination && !target.inFilesRoot) return
        usePrototypeStore.getState().moveChat(target.id, destination, placement(destination))
        return
      }
      const state = cache.readState()
      const node = target.node
      if (!state) return
      const parent = destination ?? state.chatsFolderId
      if (node.parentId === parent) return
      const sortOrder = topOrderIn(client, namespace, destination)
      await mutate(() => {
        if (node.kind === 'folder') cache.writeState((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === node.id ? { ...folder, parentId: parent } : folder) }))
        if (node.pinned) {
          cache.writePinned((items) => items.map((item) => item.id === node.id ? { ...item, parentId: parent } : item))
          return
        }
        cache.writeListings((items) => items.filter((item) => item.id !== node.id))
        cache.writeListing(parent, (items) => [{ ...node, parentId: parent, sortOrder }, ...items])
      }, () => moveSidebarItems([node.id], destination), { name: node.name })
    },

    /** Pins after everything pinned, or unpins back to the top of its folder; it stays where it is in Files. */
    async setPinned(target: SidebarTarget, pinned: boolean): Promise<void> {
      const state = cache.readState()
      if (target.kind === 'chat') {
        if (target.pinned === pinned) return
        if (target.inFilesRoot && !pinned && state) {
          // The sidebar's unpin puts it at the top of My files, where it stays; the chat's own
          // would keep its place in the pinned list as its place there.
          const restore = (value: boolean) => usePrototypeStore.setState((current) => ({
            chats: current.chats.map((chat) => chat.id === target.id ? { ...chat, pinned: value } : chat),
          }))
          restore(false)
          try {
            await pinItems([target.id], false)
          } catch (cause) {
            restore(true)
            fail(cause, target.name)
          } finally {
            await refresh(true)
          }
          return
        }
        usePrototypeStore.getState().togglePin(target.id, pinnedItemsCeiling(state), placement(target.inFilesRoot ? null : target.folderId))
        return
      }
      const node = target.node
      if (!state || Boolean(node.pinned) === pinned) return
      const chats = visibleHistoryChats(usePrototypeStore.getState().chats)
      const end = chats.reduce((max, chat) => chat.pinned ? Math.max(max, chat.sortOrder) : max, pinnedItemsCeiling(state)) + 1
      const parent = node.parentId
      const top = parent ? topOrderIn(client, namespace, inSidebar(parent)) : 0
      await mutate(() => {
        if (pinned) {
          cache.writePinned((items) => [...items.filter((item) => item.id !== node.id), { ...node, pinned: true, sortOrder: end }])
          cache.writeListings((items) => items.filter((item) => item.id !== node.id))
        } else {
          cache.writePinned((items) => items.filter((item) => item.id !== node.id))
          if (parent) cache.writeListing(parent, (items) => [{ ...node, pinned: false, sortOrder: top }, ...items.filter((item) => item.id !== node.id)])
        }
      }, () => pinItems([node.id], pinned), { name: node.name })
    },

    /** Unpins a chat or Files item and moves it into the Archive folder, offering to undo it. */
    async archive(target: SidebarTarget): Promise<void> {
      const state = cache.readState()
      if (!state) return
      const pinnedBefore = pinnedOrder(state)
      const name = nameOf(target)
      let id: string
      // Null: the top of My files.
      let parentId: string | null
      let wasPinned: boolean
      if (target.kind === 'chat') {
        ({ id, pinned: wasPinned } = target)
        parentId = target.inFilesRoot ? null : target.folderId ?? state.chatsFolderId
        // Kept for later offline, like the chat's other changes; it can only be undone once sent.
        const outcome = await usePrototypeStore.getState().archiveChat(id, state.archiveFolderId)
        if (outcome === 'failed') return
        if (outcome === 'queued') {
          show({ message: `“${name}” will move to the archive once you’re back online` })
          return
        }
      } else {
        const node = target.node
        id = node.id
        parentId = node.parentId
        wasPinned = Boolean(node.pinned)
        const archived = await mutate(() => {
          if (node.kind === 'folder') cache.writeState((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === node.id ? { ...folder, parentId: current.archiveFolderId } : folder) }))
          cache.writeListings((items) => items.filter((item) => item.id !== node.id))
          cache.writePinned((items) => items.filter((item) => item.id !== node.id))
        }, () => archiveSidebarItems({ chatIds: [], fileIds: [node.id] }), { name })
        if (!archived) return
      }
      show({ message: `Moved “${name}” to the archive`, undo: () => putBack(id, parentId, wasPinned, pinnedBefore) })
    },

    /**
     * Trashes a folder, file, or shortcut, offering to undo it. Chats in a trashed folder go back
     * to the top of the sidebar rather than to the trash.
     */
    async trash(node: FileNode): Promise<void> {
      const state = cache.readState()
      if (!state) return
      const removed = new Set([node.id, ...node.kind === 'folder' ? state.folders.filter((folder) => isWithin(state, folder.id, node.id)).map((folder) => folder.id) : []])
      const trashed = await mutate(() => {
        cache.writeState((current) => ({ ...current, folders: current.folders.filter((folder) => !removed.has(folder.id)) }))
        cache.writeListings((items) => items.filter((item) => !removed.has(item.id)))
        cache.writePinned((items) => items.filter((item) => !removed.has(item.id)))
        usePrototypeStore.setState((current) => ({
          chats: current.chats.map((chat) => chat.folderId && removed.has(chat.folderId) ? { ...chat, folderId: null } : chat),
        }))
      }, () => trashSidebarItems([node.id]), { name: node.name, chats: true })
      if (!trashed) return
      const roots = trashed.value
      show({
        message: node.kind === 'shortcut' ? `Deleted “${node.name}”` : `Moved “${node.name}” to the trash`,
        undo: roots.length ? async () => {
          try {
            await restoreSidebarItems(roots)
          } catch (cause) {
            fail(cause)
          } finally {
            await refresh(true)
          }
        } : undefined,
      })
    },
  }
}

export type SidebarOperations = ReturnType<typeof sidebarOperations>

export function useSidebarOperations(namespace: string): SidebarOperations {
  const client = useQueryClient()
  const show = useFilesToasts((state) => state.show)
  return useMemo(() => sidebarOperations(client, namespace, show), [client, namespace, show])
}
