import { FILE_TREE_MAX_DEPTH, type FileNode, type SidebarFolder, type SidebarState } from '@pulpo/contracts'
import { compareChatOrder, historySection, type HistoryChatSummary } from '../chat/history'

/*
 * The drawer as the web sidebar shows it (apps/web/src/components/layout/Sidebar.tsx): pinned chats
 * and Files items in one list, then the Chats folder's chats, folders, files, and shortcuts in their
 * shared manual order. Folders open in place; their contents load once opened.
 */

/** A folder in the drawer: a Files folder, a shortcut to one, or (servers without the sidebar) a chat folder. */
export interface SidebarFolderRow {
  type: 'folder'
  key: string
  depth: number
  /** The item the row is: the folder, or the shortcut to it. */
  node: FileNode
  /** The folder it opens. */
  folderId: string
  /** What remembers it open: the folder's id, or `shortcut:<id>` (a shortcut opens on its own). */
  expansionKey: string
  expanded: boolean
  /** Unpinned chats in it, as the web counts them. */
  chatCount: number
  /** A chat folder from /api/folders: it holds only chats, and can only be renamed or deleted. */
  legacy?: boolean
}

export type SidebarRow =
  | { type: 'chat'; key: string; depth: number; chat: HistoryChatSummary }
  | SidebarFolderRow
  | { type: 'item'; key: string; depth: number; node: FileNode }
  | { type: 'empty'; key: string; depth: number; label: string }

export interface SidebarSection {
  key: string
  title: string
  data: SidebarRow[]
  /** The list's own heading (sort order, New folder), on the first section below Pinned. */
  heading?: boolean
}

/** Why a listing the drawer needs is missing: offline with no copy on the device, or refused. */
export type SidebarUnavailable = 'offline' | 'failed'

export interface SidebarTreeInput {
  chats: readonly HistoryChatSummary[]
  /** Undefined until loaded; null on servers without the sidebar, where `legacyFolders` apply. */
  sidebar: SidebarState | null | undefined
  legacyFolders?: readonly { id: string; name: string }[]
  /** Loaded folder listings; a folder missing here is still loading, unless `unavailable` says otherwise. */
  listings: ReadonlyMap<string, readonly FileNode[]>
  unavailable?: ReadonlyMap<string, SidebarUnavailable>
  expanded: ReadonlySet<string>
  order: 'default' | 'recent'
  filesEnabled: boolean
  now?: number
}

export interface SidebarTree {
  sections: SidebarSection[]
  /** The folders whose listings it needs: the top level and every open folder it shows. */
  folderIds: string[]
}

type Entry =
  | { kind: 'chat'; id: string; sortOrder: number; createdAt: number; updatedAt: number; chat: HistoryChatSummary }
  | { kind: 'node'; id: string; sortOrder: number; createdAt: number; updatedAt: number; node: FileNode; legacy?: boolean }

const UNAVAILABLE_LABELS: Record<SidebarUnavailable | 'loading', string> = {
  loading: 'Loading…',
  offline: 'Not available offline',
  failed: 'Couldn’t load this folder',
}

const ROOT_UNAVAILABLE_LABELS: Record<SidebarUnavailable, string> = {
  offline: 'Your folders aren’t available offline',
  failed: 'Couldn’t load your folders',
}

/** Without Files, only folders and shortcuts to folders or chats show, as the server lists them. */
export function shownInSidebar(node: FileNode, filesEnabled: boolean): boolean {
  if (filesEnabled) return true
  return node.kind === 'folder' || (node.kind === 'shortcut' && (node.target?.kind === 'folder' || node.target?.kind === 'chat'))
}

/** A folder's chats and Files items as one list: in their shared manual order (newest first on ties), or most recently updated first. */
function entries(chats: readonly HistoryChatSummary[], nodes: readonly FileNode[], recent: boolean, legacy = false): Entry[] {
  const list: Entry[] = [
    ...chats.map((chat): Entry => ({ kind: 'chat', id: chat.id, sortOrder: chat.sortOrder, createdAt: chat.createdAt, updatedAt: chat.updatedAt, chat })),
    ...nodes.map((node): Entry => ({
      kind: 'node', id: node.id, sortOrder: node.sortOrder ?? 0, createdAt: Date.parse(node.createdAt), updatedAt: Date.parse(node.updatedAt), node, legacy,
    })),
  ]
  return list.sort(recent ? (left, right) => right.updatedAt - left.updatedAt : compareChatOrder)
}

/** A chat folder from /api/folders as a Files folder, listed above the chats (as the server's migration placed them). */
function legacyFolderNode(folder: { id: string; name: string }, index: number, updatedAt: number): FileNode {
  const at = new Date(updatedAt).toISOString()
  return {
    id: folder.id, parentId: null, kind: 'folder', name: folder.name, status: 'ready', mimeType: null, sizeBytes: 0,
    revision: 0, trashedAt: null, createdAt: at, updatedAt: at, systemRole: null, sortOrder: -1_000_000 + index,
  }
}

export function buildSidebarTree(input: SidebarTreeInput): SidebarTree {
  const { sidebar, listings, expanded, filesEnabled } = input
  const now = input.now ?? Date.now()
  const recent = input.order === 'recent'
  const folderIds: string[] = []
  const need = (id: string) => { if (!folderIds.includes(id)) folderIds.push(id) }

  // Chats filed in folders show inside them; chats at the top of My files stay in Files. Without
  // the sidebar, a chat in a folder not (yet) listed shows unfiled, as chat folders always did.
  const legacyIds = sidebar === null ? new Set((input.legacyFolders ?? []).map((folder) => folder.id)) : null
  const pinnedChats: HistoryChatSummary[] = []
  const loose: HistoryChatSummary[] = []
  const inFolders = new Map<string, HistoryChatSummary[]>()
  for (const chat of input.chats) {
    if (chat.pinned) pinnedChats.push(chat)
    else if (chat.inFilesRoot) continue
    else if (!chat.folderId || (legacyIds && !legacyIds.has(chat.folderId))) loose.push(chat)
    else {
      const folder = inFolders.get(chat.folderId)
      if (folder) folder.push(chat)
      else inFolders.set(chat.folderId, [chat])
    }
  }
  const visible = (nodes: readonly FileNode[] | undefined) => (nodes ?? []).filter((node) => shownInSidebar(node, filesEnabled))

  const emit = (list: readonly Entry[], depth: number, path: readonly string[], parentKey: string, rows: SidebarRow[]) => {
    for (const entry of list) {
      const key = `${parentKey}/${entry.id}`
      if (entry.kind === 'chat') {
        rows.push({ type: 'chat', key, depth, chat: entry.chat })
        continue
      }
      const node = entry.node
      // A shortcut to a folder opens in place, like the folder itself.
      const folderId = node.kind === 'folder' ? node.id
        : node.kind === 'shortcut' && node.target?.kind === 'folder' && node.target.available ? node.target.id
          : null
      // A shortcut to a folder it is in (the Chats folder at the top) would only open into itself:
      // it opens in Files instead, like other items.
      if (!folderId || path.includes(folderId)) {
        rows.push({ type: 'item', key, depth, node })
        continue
      }
      const expansionKey = node.kind === 'shortcut' ? `shortcut:${node.id}` : node.id
      // A shortcut to the Chats folder opens the top of the sidebar, unfiled chats included.
      const chats = folderId === sidebar?.chatsFolderId ? loose : inFolders.get(folderId) ?? []
      const open = expanded.has(expansionKey) && depth < FILE_TREE_MAX_DEPTH
      rows.push({ type: 'folder', key, depth, node, folderId, expansionKey, expanded: open, chatCount: chats.length, ...entry.legacy ? { legacy: true } : {} })
      if (!open) continue
      let items: readonly FileNode[] = []
      let label = 'Empty'
      if (!entry.legacy) {
        need(folderId)
        const listing = listings.get(folderId)
        items = visible(listing)
        if (!listing) label = UNAVAILABLE_LABELS[input.unavailable?.get(folderId) ?? 'loading']
      }
      const contents = entries(chats, items, false)
      if (contents.length) emit(contents, depth + 1, [...path, folderId], key, rows)
      else rows.push({ type: 'empty', key: `${key}/empty`, depth: depth + 1, label })
    }
  }

  const sections: SidebarSection[] = []
  const pinnedRows: SidebarRow[] = []
  emit(entries(pinnedChats, sidebar ? visible(sidebar.pinnedItems) : [], false), 0, [], 'pinned', pinnedRows)
  if (pinnedRows.length) sections.push({ key: 'pinned', title: 'Pinned', data: pinnedRows })

  let rootNodes: FileNode[] = []
  let legacy = false
  if (sidebar) {
    need(sidebar.chatsFolderId)
    rootNodes = visible(listings.get(sidebar.chatsFolderId))
  } else if (sidebar === null) {
    legacy = true
    // A chat folder's last activity is its latest chat's, for recent order.
    rootNodes = (input.legacyFolders ?? []).map((folder, index) => legacyFolderNode(
      folder, index, (inFolders.get(folder.id) ?? []).reduce((latest, chat) => Math.max(latest, chat.updatedAt), 0),
    ))
  }
  const root = entries(loose, rootNodes, recent, legacy)
  // The top level is the Chats folder: a shortcut to it there would only list it again.
  const rootPath = sidebar ? [sidebar.chatsFolderId] : []
  if (recent) {
    // Recent order lists the top level by last activity under time headings; folders keep their manual order inside.
    for (const entry of root) {
      const title = historySection(entry.updatedAt, now)
      let section = sections.at(-1)
      if (!section || section.key !== `recent:${title}`) {
        section = { key: `recent:${title}`, title, data: [] }
        sections.push(section)
      }
      emit([entry], 0, rootPath, 'root', section.data)
    }
  } else if (root.length) {
    const data: SidebarRow[] = []
    emit(root, 0, rootPath, 'root', data)
    sections.push({ key: 'chats', title: 'Chats', data })
  }
  // Without the top level's listing, its folders and their chats are missing: say so.
  const rootMissing = sidebar && !listings.get(sidebar.chatsFolderId) ? input.unavailable?.get(sidebar.chatsFolderId) : undefined
  const notice: SidebarRow | null = rootMissing ? { type: 'empty', key: 'root/unavailable', depth: 0, label: ROOT_UNAVAILABLE_LABELS[rootMissing] } : null
  const first = sections.find((section) => section.key !== 'pinned')
  if (first) {
    first.heading = true
    if (notice) first.data.unshift(notice)
  } else {
    sections.push({ key: 'chats', title: 'Chats', heading: true, data: [notice ?? { type: 'empty', key: 'root/empty', depth: 0, label: 'No chats yet' }] })
  }
  return { sections, folderIds }
}

/** The last place in the pinned list taken by Files items, so a chat pinned now goes after them too. */
export function pinnedItemsCeiling(sidebar: SidebarState | null | undefined): number {
  return (sidebar?.pinnedItems ?? []).reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1)
}

export function sortFolders(folders: readonly SidebarFolder[]): SidebarFolder[] {
  return [...folders].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export interface FolderChoice {
  id: string
  name: string
  depth: number
}

/**
 * Every folder something can be moved into from the drawer, depth-first with its nesting: the
 * Chats folder's, then the Archive and its folders (with Files on, as on the web).
 */
export function folderOutline(sidebar: SidebarState | null | undefined, filesEnabled: boolean): FolderChoice[] {
  if (!sidebar) return []
  const children = new Map<string, SidebarFolder[]>()
  for (const folder of sidebar.folders) {
    if (!folder.parentId) continue
    children.set(folder.parentId, [...children.get(folder.parentId) ?? [], folder])
  }
  const outline: FolderChoice[] = []
  const seen = new Set<string>()
  const walk = (parentId: string, depth: number) => {
    for (const folder of sortFolders(children.get(parentId) ?? [])) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)
      outline.push({ id: folder.id, name: folder.name, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(sidebar.chatsFolderId, 0)
  const archive = sidebar.folders.find((folder) => folder.id === sidebar.archiveFolderId)
  if (archive && filesEnabled) {
    outline.push({ id: archive.id, name: archive.name, depth: 0 })
    seen.add(archive.id)
    walk(archive.id, 1)
  }
  return outline
}

/** Whether `folderId` is `ancestorId` or inside it. */
export function isWithin(sidebar: SidebarState | null | undefined, folderId: string, ancestorId: string): boolean {
  const byId = new Map(sidebar?.folders.map((folder) => [folder.id, folder]))
  const seen = new Set<string>()
  for (let current: string | null | undefined = folderId; current && !seen.has(current); current = byId.get(current)?.parentId) {
    if (current === ancestorId) return true
    seen.add(current)
  }
  return false
}
