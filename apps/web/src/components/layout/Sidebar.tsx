import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ArrowDownUp,
  BarChart3,
  ClipboardPaste,
  CopyPlus,
  FilePlus2,
  Upload,
  CreditCard,
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Hourglass,
  KeyRound,
  LogOut,
  Loader2,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SquarePen,
  Trash2,
  UsersRound,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  SquareArrowOutUpRight,
  ExternalLink,
} from 'lucide-react'
import type { FileNode, SidebarFolder, SidebarState } from '@pulpo/contracts'
import { cn } from '@/lib/utils'
import { reorderList } from '@/lib/model-order'
import { useChat } from '@/stores/chat'
import { useAuth } from '@/stores/auth'
import { useSettings, type ChatSortMode } from '@/stores/settings'
import { CHAT_TIME_GROUPS, chatTimeGroup, type ChatTimeGroup } from '@/lib/format'
import { chatHasStreamingResponse } from '@/lib/response-tracking'
import type { Chat } from '@/lib/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { AccountSwitcherMenuItems } from '@/components/layout/AccountSwitcher'
import { apiRequest } from '@/lib/api'
import { toggleSidebarPin, type SidebarPinKey } from '@/lib/sidebar-pins'
import { newChatLocationState } from '@/lib/new-chat-navigation'
import { billingPlanTier, fetchBillingSummary } from '@/lib/billing'
import { isDesktopRuntime } from '@/lib/runtime'
import { ui, uit } from '@/i18n/ui'
import { FilesNavMenu } from '@/features/files/FilesNavMenu'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { registerItemDropZone } from '@/features/files/browser/use-item-drag'
import { AppearanceDialog } from '@/features/files/AppearanceDialog'
import { editAppearance, hasAppearance } from '@/features/files/appearance'
import { FolderPickerDialog } from '@/features/sidebar/FolderPickerDialog'
import { writeSidebarItems, type SidebarDragItem } from '@/features/sidebar/drag-data'
import { clickSelect, EMPTY_SELECTION, selectOnly, type FileSelection } from '@/features/files/browser/selection'
import { isEditableTarget } from '@/features/files/browser/shortcuts'
import { useFileClipboard } from '@/features/files/browser/clipboard'
import { useFileOperations } from '@/features/files/browser/use-file-operations'
import { useSidePanel } from '@/features/side-panel/store'
import { openBeside, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { copyChatShareLink, duplicateChats } from '@/features/chat/chat-actions'
import { ChatExpiryMenuItem } from '@/features/chat/ChatExpiryMenuItem'
import {
  archiveSidebarSelection,
  createShortcutInteractively,
  createSidebarFolder,
  findSidebarItem,
  folderOutline,
  isWithin,
  moveSidebarSelection,
  newSidebarFile,
  orderPinnedItems,
  orderSidebarItems,
  pinSidebarItems,
  refreshSidebar,
  pickFolder,
  renameSidebarItem,
  trashSidebarSelection,
  useFolderExpansion,
  useSidebarItems,
  uploadToSidebar,
  useSidebarState,
} from '@/features/sidebar/api'

/** A chat, a folder, or another Files item (a file or shortcut). */
type DragKind = 'folder' | 'chat' | 'item'
/** The pinned list, the top of the sidebar (the Chats folder), or a folder's items. */
type DropList = 'pinned' | 'loose' | `folder:${string}`

type DropHint =
  | { kind: 'row'; list: DropList; id: string; edge: 'before' | 'after' }
  | { kind: 'folder-target'; folderId: string }
  | { kind: 'loose-target' }

function sameDropHint(a: DropHint | null, b: DropHint | null) {
  if (!a || !b) return a === b
  if (a.kind === 'row' && b.kind === 'row') {
    return a.list === b.list && a.id === b.id && a.edge === b.edge
  }
  if (a.kind === 'folder-target' && b.kind === 'folder-target') return a.folderId === b.folderId
  return a.kind === b.kind
}

function folderListId(folderId: string): DropList {
  return `folder:${folderId}`
}

/** The ids of a list's rows, top to bottom, as the sidebar shows them. */
function listRowIds(list: DropList, root: ParentNode = document): string[] {
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-drag-list]')).filter((row) => row.dataset.dragList === list)
  return [...new Set(rows.map((row) => row.dataset.dragId ?? ''))].filter(Boolean)
}

function useSidebarDrag({ canEnter, folderOfList, groupOf }: {
  /** Whether the dragged item `id` may go in `folderId`; a folder never goes inside itself. */
  canEnter: (id: string, folderId: string) => boolean
  folderOfList: (list: DropList) => string | null
  /** The selected items a row drags along when it is one of several selected, in sidebar order. */
  groupOf: (id: string) => SidebarDragItem[] | null
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<DragKind | null>(null)
  const [dragList, setDragList] = useState<DropList | null>(null)
  const [drop, setDropState] = useState<DropHint | null>(null)
  // Drops commit whatever the last dragover showed, so read it synchronously.
  const dropRef = useRef<DropHint | null>(null)
  const setDrop = (next: DropHint | null) => {
    if (sameDropHint(dropRef.current, next)) return
    dropRef.current = next
    setDropState(next)
  }
  const dragIdRef = useRef<string | null>(null)
  const dragKindRef = useRef<DragKind | null>(null)
  const dragListRef = useRef<DropList | null>(null)
  const didDragRef = useRef(false)
  const groupRef = useRef<SidebarDragItem[] | null>(null)
  const [dragGroup, setDragGroup] = useState<readonly string[] | null>(null)

  const clearDrag = () => {
    // Browsers send no click after a drag, so the flag only needs to outlive this event.
    window.setTimeout(() => { didDragRef.current = false }, 0)
    dragIdRef.current = null
    dragKindRef.current = null
    dragListRef.current = null
    groupRef.current = null
    setDragGroup(null)
    setDragId(null)
    setDragKind(null)
    setDragList(null)
    setDrop(null)
  }

  /** `item` lets folders in Files take the drag too. */
  const startDrag = (kind: DragKind, id: string, e: DragEvent, list?: DropList, item?: Pick<FileNode, 'id' | 'kind' | 'name' | 'parentId'>) => {
    // Nested rows (a chat inside a folder) must not also start their folder's drag.
    e.stopPropagation()
    didDragRef.current = false
    const group = groupOf(id)
    groupRef.current = group
    setDragGroup(group && group.map((member) => member.id))
    dragIdRef.current = id
    dragKindRef.current = kind
    dragListRef.current = list ?? null
    setDragId(id)
    setDragKind(kind)
    setDragList(list ?? null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.setData('application/x-pulpo-drag', kind)
    const items = group ?? (item ? [item] : [])
    if (items.length) writeSidebarItems(e.dataTransfer, items)
  }

  /** Whether `id` is the dragged row or one of the selected items dragged with it. */
  const isDragged = (id: string) => groupRef.current ? groupRef.current.some((member) => member.id === id) : id === dragIdRef.current
  /** Whether everything dragged may go in `folderId`. */
  const fitsIn = (folderId: string) => (groupRef.current?.map((member) => member.id) ?? [dragIdRef.current!]).every((id) => canEnter(id, folderId))

  const acceptMove = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    didDragRef.current = true
  }

  const edgeFor = (e: DragEvent<HTMLElement>): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  /** Anything can be pinned, or go in any folder that is not inside it. */
  const canPlaceIn = (list: DropList) => {
    const kind = dragKindRef.current
    const id = dragIdRef.current
    if (!kind || !id) return false
    if (list === 'pinned') return true
    const folderId = folderOfList(list)
    return Boolean(folderId) && fitsIn(folderId!)
  }

  /** Shows the slot nearest the pointer among `list`'s rows inside the element handling the drag. */
  const snapToList = (e: DragEvent<HTMLElement>, list: DropList) => {
    // Selected rows dragged together leave the list while they move.
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-drag-list]'))
      .filter((row) => row.dataset.dragList === list && !(groupRef.current && isDragged(row.dataset.dragId ?? '')))
    const source = dragListRef.current
    if (rows.length === 0) {
      setDrop(list === 'loose' && source !== 'loose' ? { kind: 'loose-target' } : null)
      return
    }
    const ids = rows.map((row) => row.dataset.dragId ?? '')
    let slot = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect()
      return e.clientY < rect.top + rect.height / 2
    })
    if (slot < 0) slot = rows.length
    const dragged = ids.indexOf(dragIdRef.current ?? '')
    // Slots on either side of the dragged row leave it where it is.
    if (dragged >= 0 && (slot === dragged || slot === dragged + 1)) {
      setDrop(null)
      return
    }
    setDrop(slot < rows.length
      ? { kind: 'row', list, id: ids[slot]!, edge: 'before' }
      : { kind: 'row', list, id: ids.at(-1)!, edge: 'after' })
  }

  /**
   * A folder's header. The middle files the dragged item into the folder (at its top); with
   * `row`, the top and bottom edges place it beside the folder in the list the folder is in.
   */
  const onFolderDragOver = (folderId: string, e: DragEvent<HTMLElement>, row?: { list: DropList; id: string }) => {
    const kind = dragKindRef.current
    const id = dragIdRef.current
    if (!kind || !id) return
    if (row && !isDragged(row.id) && canPlaceIn(row.list)) {
      const rect = e.currentTarget.getBoundingClientRect()
      const band = rect.height / 4
      if (e.clientY < rect.top + band || e.clientY > rect.bottom - band) {
        acceptMove(e)
        setDrop({ kind: 'row', list: row.list, id: row.id, edge: e.clientY < rect.top + band ? 'before' : 'after' })
        return
      }
    }
    if ((row && isDragged(row.id)) || dragListRef.current === folderListId(folderId) || !fitsIn(folderId)) return
    acceptMove(e)
    setDrop({ kind: 'folder-target', folderId })
  }

  /** An open folder's contents: rows of that folder reorder within it; anything else goes into it. */
  const onFolderBodyDragOver = (folderId: string, e: DragEvent<HTMLElement>) => {
    const kind = dragKindRef.current
    const id = dragIdRef.current
    if (!kind || !id) return
    const list = folderListId(folderId)
    if (dragListRef.current === list) {
      acceptMove(e)
      snapToList(e, list)
      return
    }
    if (!fitsIn(folderId)) return
    acceptMove(e)
    setDrop({ kind: 'folder-target', folderId })
  }

  const onRowDragOver = (list: DropList, id: string, e: DragEvent<HTMLElement>) => {
    if (!dragIdRef.current || isDragged(id) || !canPlaceIn(list)) return
    acceptMove(e)
    setDrop({ kind: 'row', list, id, edge: edgeFor(e) })
  }

  /**
   * Everywhere a row or folder does not claim the drag (gaps, headers, empty space), snap to the
   * nearest slot at the top level of the sidebar, or in the pinned list for a drag into its area.
   */
  const onSidebarDragOver = (e: DragEvent<HTMLElement>, zones: { pinnedBottom?: number }) => {
    const kind = dragKindRef.current
    if (!kind || !dragIdRef.current) return
    acceptMove(e)
    const list: DropList = zones.pinnedBottom !== undefined && e.clientY < zones.pinnedBottom ? 'pinned' : 'loose'
    if (!canPlaceIn(list)) {
      setDrop(null)
      return
    }
    snapToList(e, list)
  }

  /**
   * Where items dragged in from the Files browser would land with the pointer over `element`,
   * the same as for a drag within the sidebar: between rows, beside a folder from the edges of
   * its row, into a folder from its middle or open contents, or the nearest slot at the top level
   * or in the pinned list.
   */
  const filesDropHint = (aside: HTMLElement, element: Element, y: number, nodes: readonly FileNode[]): DropHint | null => {
    if (nodes.some((node) => node.systemRole)) return null
    const ids = new Set(nodes.map((node) => node.id))
    const fits = (folderId: string | null) => Boolean(folderId)
      && nodes.every((node) => canEnter(node.id, folderId!))
    const beside = (row: HTMLElement, band: number): DropHint | null => {
      const list = row.dataset.dragList as DropList | undefined
      const id = row.dataset.dragId
      if (!list || !id || ids.has(id) || (list !== 'pinned' && !fits(folderOfList(list)))) return null
      const rect = row.getBoundingClientRect()
      if (y < rect.top + band * rect.height) return { kind: 'row', list, id, edge: 'before' }
      if (y > rect.bottom - band * rect.height) return { kind: 'row', list, id, edge: 'after' }
      return null
    }
    const folderRow = element.closest<HTMLElement>('[data-folder-row]')
    if (folderRow) {
      const folderId = folderRow.dataset.folderRow!
      return beside(folderRow, 1 / 4) ?? (fits(folderId) && !ids.has(folderRow.dataset.dragId ?? folderId) ? { kind: 'folder-target', folderId } : null)
    }
    const row = element.closest<HTMLElement>('[data-drag-list]')
    if (row) return beside(row, 1 / 2)
    const body = element.closest<HTMLElement>('[data-folder-body]')
    if (body) return fits(body.dataset.folderBody!) ? { kind: 'folder-target', folderId: body.dataset.folderBody! } : null
    const list: DropList = element.closest('[data-pinned-zone]') ? 'pinned' : 'loose'
    if (list === 'loose' && !fits(folderOfList('loose'))) return null
    const rows = Array.from(aside.querySelectorAll<HTMLElement>('[data-drag-list]'))
      .filter((candidate) => candidate.dataset.dragList === list && !ids.has(candidate.dataset.dragId ?? ''))
    if (rows.length === 0) return list === 'loose' ? { kind: 'loose-target' } : null
    const slot = rows.findIndex((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    })
    return slot < 0
      ? { kind: 'row', list, id: rows.at(-1)!.dataset.dragId!, edge: 'after' }
      : { kind: 'row', list, id: rows[slot]!.dataset.dragId!, edge: 'before' }
  }

  const onSidebarDragLeave = (e: DragEvent<HTMLElement>) => {
    // Leaving the sidebar cancels the drop, so stop showing where it would land.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
  }

  /** Drop-line props for a row in `list`. */
  const rowLines = (list: DropList, id: string, kind: DragKind) => {
    const isDragging = dragGroup ? dragGroup.includes(id) : dragKind === kind && dragId === id
    const rowDrop = drop?.kind === 'row' && drop.list === list && drop.id === id && !isDragging
    return {
      dragging: isDragging,
      showLineBefore: Boolean(rowDrop && drop?.kind === 'row' && drop.edge === 'before'),
      showLineAfter: Boolean(rowDrop && drop?.kind === 'row' && drop.edge === 'after'),
    }
  }

  return {
    dragId,
    dragKind,
    dragList,
    drop,
    didDragRef,
    dragIdRef,
    dragKindRef,
    dragListRef,
    groupRef,
    clearDrag,
    startDrag,
    onFolderDragOver,
    onFolderBodyDragOver,
    onRowDragOver,
    onSidebarDragOver,
    onSidebarDragLeave,
    rowLines,
    dropRef,
    setDrop,
    filesDropHint,
  }
}

type SidebarDrag = ReturnType<typeof useSidebarDrag>

function DropLines({
  active,
  before,
  after,
}: {
  active: boolean
  before: boolean
  after: boolean
}) {
  if (!active) return null
  return (
    <>
      {before && <div className="pointer-events-none absolute inset-x-2 -top-px z-10 h-0.5 rounded-full bg-foreground/35" />}
      {after && <div className="pointer-events-none absolute inset-x-2 -bottom-px z-10 h-0.5 rounded-full bg-foreground/35" />}
    </>
  )
}

/**
 * A chat's actions, the same from its row's "⋯" button and from right-clicking the row
 * (`atPointer` only places it at the pointer). The desktop app has no tabs, so no new-tab item.
 */
function ChatMenu({ chat, onRename, atPointer = false }: { chat: Chat; onRename: () => void; atPointer?: boolean }) {
  const renaming = useRef(false)
  const { t } = useTranslation()
  const togglePin = useChat((state) => state.togglePin)
  const sidebar = useSidebarState().data
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const archived = Boolean(sidebar && chat.folderId && isWithin(sidebar, chat.folderId, sidebar.archiveFolderId))
  const trashRetention = useSettings((state) => state.trashRetention)
  return (
    <DropdownMenuContent
      side={atPointer ? 'bottom' : 'right'}
      align="start"
      sideOffset={atPointer ? 2 : undefined}
      className="w-48"
      // Start the inline rename only once the menu has closed: a modal menu traps focus until
      // then and would pull it back out of the input. Keep focus off the trigger, too.
      onCloseAutoFocus={(event) => {
        if (!renaming.current) return
        renaming.current = false
        event.preventDefault()
        onRename()
      }}
    >
      {!isDesktopRuntime() && (
        <DropdownMenuItem onClick={() => { window.open(`/c/${chat.id}`, '_blank', 'noopener') }}>
          <ExternalLink />
          {ui("Open in new tab")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => togglePin(chat.id)}>
        {chat.pinned ? <PinOff /> : <Pin />}
        {chat.pinned ? t('chat.unpin') : t('chat.pin')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => { renaming.current = true }}>
        <Pencil />
        {t('common.rename')}
      </DropdownMenuItem>
      <ChatExpiryMenuItem chat={chat} />
      {sidebar && (
        <MoveToFolderSub
          sidebar={sidebar}
          current={chat.folderId}
          onMove={(folderId) => void moveSidebarSelection([chat.id], folderId)}
          onOther={() => void moveInteractively([{ id: chat.id, name: chat.title }], sidebar, chat.folderId ?? sidebar.chatsFolderId)}
        />
      )}
      {/* The Archive folder is only reachable through Files. */}
      {!archived && sidebar && filesEnabled && (
        <DropdownMenuItem onClick={() => void archiveSidebarSelection([chat.id])}>
          <Archive />
          {ui("Move to archive")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => void createShortcutInteractively('chat', chat.id)}>
        <SquareArrowOutUpRight />
        {ui("Create shortcut…")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void duplicateChats([chat])}>
        <CopyPlus />
        {ui("Duplicate")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void copyChatShareLink(chat.id)}>
        <Share2 />
        {t('chat.copyShareLink')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => void trashSidebarSelection([chat.id])}>
        <Trash2 />
        {trashRetention === 'instant' ? t('common.delete') : t('chat.trash')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

/**
 * "Move to folder": the sidebar's folders and Archive, or (with Files) any folder in Files. The
 * folder things are in now (`current`, null for the top of the sidebar) and folders they cannot
 * go in (`blocked`, e.g. a folder's own subfolders) are unavailable.
 */
function MoveToFolderSub({ sidebar, current, blocked, onMove, onOther }: {
  sidebar: SidebarState
  current?: string | null
  blocked?: (folderId: string) => boolean
  onMove: (folderId: string | null) => void
  onOther: () => void
}) {
  const { t } = useTranslation()
  const filesEnabled = useAuth((state) => state.filesEnabled)
  // Without Files, nothing shows what is in Archive, so nothing is moved there.
  const outline = folderOutline(sidebar).filter(({ folder }) => filesEnabled || !isWithin(sidebar, folder.id, sidebar.archiveFolderId))
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput />
        {t('chat.moveToFolder')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
        <DropdownMenuItem disabled={current === null} onClick={() => onMove(null)}>
          {t('chat.noFolder')}
        </DropdownMenuItem>
        {outline.length > 0 && <DropdownMenuSeparator />}
        {outline.map(({ folder, depth }) => (
          <DropdownMenuItem
            key={folder.id}
            disabled={current === folder.id || Boolean(blocked?.(folder.id))}
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            onClick={() => onMove(folder.id)}
          >
            {folder.systemRole === 'archive' ? <Archive /> : <FolderIcon />}
            <span className="truncate">{folder.name}</span>
          </DropdownMenuItem>
        ))}
        {filesEnabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOther}>
              <FolderOpen />
              {ui("Other folder…")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Moves chats and Files items into any folder of Files, chosen in the destination dialog. */
async function moveInteractively(items: readonly { id: string; name: string }[], sidebar: SidebarState, initialFolderId: string) {
  const destination = await pickFolder({
    title: items.length === 1 ? uit`Move "${items[0]!.name}"` : uit`Move ${items.length} items`,
    action: ui("Move here"),
    initialFolderId,
    // A folder cannot go inside itself.
    excludedIds: new Set(items.map((item) => item.id)),
  })
  if (destination === undefined) return
  // My files and the Chats folder both mean the top of the sidebar.
  await moveSidebarSelection(items.map((item) => item.id), destination === sidebar.chatsFolderId ? null : destination)
}

/**
 * Edits a sidebar title in place. Enter or blur saves, Escape cancels, and a blank or
 * unchanged title leaves the old one.
 */
function InlineTitleInput({ value, label, onCommit, onDone }: {
  value: string
  label: string
  onCommit: (value: string) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const finish = (save: boolean) => {
    if (settled.current) return
    settled.current = true
    const next = draft.trim()
    if (save && next && next !== value) onCommit(next)
    onDone()
  }

  return (
    <input
      ref={input}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') { event.preventDefault(); finish(true) }
        if (event.key === 'Escape') { event.preventDefault(); finish(false) }
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      draggable={false}
      className="relative z-10 w-full min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 py-px text-sm text-foreground outline-none ring-2 ring-ring/30"
    />
  )
}

function useShiftHeld() {
  const [shiftHeld, setShiftHeld] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false)
    }
    const reset = () => setShiftHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return shiftHeld
}

/** A row's part in the sidebar's multi-selection: Cmd/Ctrl-click toggles it, Shift-click selects a range. */
interface RowSelection {
  selected: boolean
  /** Handles a click; true when it changed the selection instead of opening the row. */
  onClick: (event: ReactMouseEvent) => boolean
  /** Handles a right-click; true when it opened the menu for the whole selection instead of the row's. */
  onContextMenu: (event: ReactMouseEvent) => boolean
}

const SELECTED_ROW = 'bg-sky-500/15 text-sidebar-foreground hover:bg-sky-500/20 dark:bg-sky-400/15'

/** Shown in place of a row's "⋯" button while Shift is held, to trash the row in one click. */
function QuickTrashButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="relative hidden rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-destructive group-hover:block"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={label}
    >
      <Trash2 className="size-4" />
    </button>
  )
}

/** What trashing a folder, file, or shortcut is called: shortcuts are deleted, and without Files nothing shows the trash. */
function trashLabel(node: Pick<FileNode, 'kind'>, filesEnabled: boolean, deleteLabel: string): string {
  return node.kind === 'shortcut' ? ui("Delete shortcut") : filesEnabled ? ui("Move to trash") : deleteLabel
}

/** Desktop sidebar widths, matching the classes on the sidebar below. */
export const SIDEBAR_WIDTH = 264
export const SIDEBAR_COLLAPSED_WIDTH = 52

export function ChatRow({
  chat,
  active,
  shiftHeld,
  onNavigate,
  draggable: canDrag = false,
  droppable: canDrop = false,
  dragList,
  dragId,
  dragging = false,
  showLineBefore = false,
  showLineAfter = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  didDragRef,
  selection,
}: {
  chat: Chat
  active: boolean
  shiftHeld: boolean
  selection?: RowSelection
  onNavigate?: () => void
  draggable?: boolean
  droppable?: boolean
  /** Identifies the reorderable list this row belongs to, for sidebar-wide drop snapping. */
  dragList?: string
  /** The id the row stands for in its list; the chat's own id unless it is, e.g., a shortcut. */
  dragId?: string
  dragging?: boolean
  showLineBefore?: boolean
  showLineAfter?: boolean
  onDragStart?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent) => void
  onDragEnd?: () => void
  didDragRef?: { current: boolean }
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState(false)
  // Right-clicking the row opens the chat's menu at the pointer instead of the browser's link menu.
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const renameChat = useChat((state) => state.renameChat)
  const trashRetention = useSettings((state) => state.trashRetention)
  const generating = useChat((state) => chatHasStreamingResponse(
    chat.id,
    state.streamingIds,
    state.responseChatIds,
  ))

  const actionClassName =
    'rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground'

  return (
    <div
      data-drag-list={dragList}
      data-drag-id={dragList ? dragId ?? chat.id : undefined}
      data-sidebar-select={selection ? chat.id : undefined}
      draggable={canDrag && !renaming}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrop || canDrag ? onDragOver : undefined}
      onDrop={canDrop || canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onContextMenu={(event) => {
        if (renaming || selection?.onContextMenu(event)) return
        event.preventDefault()
        setMenuPoint({ x: event.clientX, y: event.clientY })
      }}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
        selection?.selected && SELECTED_ROW,
        canDrag && 'active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <DropLines active={canDrag || canDrop} before={showLineBefore} after={showLineAfter} />
      {/* A real link (stretched over the row) so the browser offers "Open in new tab" and honors modifier clicks. */}
      {renaming ? (
        <InlineTitleInput
          value={chat.title}
          label={t('sidebar.renameChat')}
          onCommit={(next) => renameChat(chat.id, next)}
          onDone={() => setRenaming(false)}
        />
      ) : <Link
        to={`/c/${chat.id}`}
        draggable={canDrag ? false : undefined}
        className="flex-1 cursor-[inherit] truncate outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
        onClick={(e) => {
          if (didDragRef?.current) {
            didDragRef.current = false
            e.preventDefault()
            return
          }
          if (selection?.onClick(e)) return
          const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
          if (modified) {
            if (!isDesktopRuntime()) return
            e.preventDefault()
            navigate(`/c/${chat.id}`)
          }
          onNavigate?.()
        }}
      >
        {chat.title}
      </Link>}
      {shiftHeld && (
        <QuickTrashButton
          label={uit`${trashRetention === 'instant' ? t('common.delete') : t('chat.trash')} chat`}
          onClick={() => void trashSidebarSelection([chat.id])}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              actionClassName,
              'group/chat-action relative',
              generating || chat.expiresAt !== null ? 'visible' : 'invisible group-hover:visible',
              shiftHeld && 'group-hover:hidden',
              'data-[state=open]:visible',
            )}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('sidebar.chatOptions')}
          >
            {generating ? (
              <>
                <span
                  aria-hidden="true"
                  className="relative block size-4 group-hover/chat-action:hidden group-focus-visible/chat-action:hidden group-data-[state=open]/chat-action:hidden"
                >
                  <svg className="absolute inset-0 size-4 text-muted-foreground/25" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <Loader2 className="absolute inset-0 size-4 animate-spin motion-reduce:animate-none" />
                </span>
                <MoreHorizontal
                  aria-hidden="true"
                  className="hidden size-4 group-hover/chat-action:block group-focus-visible/chat-action:block group-data-[state=open]/chat-action:block"
                />
              </>
            ) : chat.expiresAt !== null ? (
              <>
                <Hourglass
                  aria-hidden="true"
                  className="size-4 text-teal-500 group-hover/chat-action:hidden group-focus-visible/chat-action:hidden group-data-[state=open]/chat-action:hidden dark:text-teal-400"
                />
                <MoreHorizontal
                  aria-hidden="true"
                  className="hidden size-4 group-hover/chat-action:block group-focus-visible/chat-action:block group-data-[state=open]/chat-action:block"
                />
              </>
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </button>
        </DropdownMenuTrigger>
        <ChatMenu chat={chat} onRename={() => setRenaming(true)} />
      </DropdownMenu>
      {menuPoint && (
        <DropdownMenu key={`${menuPoint.x}:${menuPoint.y}`} open onOpenChange={(open) => { if (!open) setMenuPoint(null) }} modal={false}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menuPoint.x, top: menuPoint.y }} />
          </DropdownMenuTrigger>
          <ChatMenu chat={chat} onRename={() => setRenaming(true)} atPointer />
        </DropdownMenu>
      )}
    </div>
  )
}

/** Shared props for everything the sidebar's folder tree renders. */
interface TreeProps {
  /** Unset until the sidebar state first loads; until then only chats are listed. */
  sidebar?: SidebarState
  chatsByFolder: ReadonlyMap<string, Chat[]>
  chatId?: string
  shiftHeld: boolean
  onNavigate: () => void
  drag: SidebarDrag
  onDrop: (e: DragEvent) => void
  onNewFolder: (parentId: string) => void
  /** A folder just created from the sidebar, which opens for renaming once it appears. */
  newFolderId: string | null
  onNewFolderNamed: () => void
  /** Opens the empty-space menu for an open folder. */
  onSpaceMenu: (event: ReactMouseEvent, folderId: string) => void
  /** The multi-selection as it concerns the row for `id`. */
  selection: (id: string) => RowSelection
  go: (path: string) => void
}

type LoadedTreeProps = TreeProps & { sidebar: SidebarState }

/** Where a row sits: the list it can be reordered in, if its list is in manual order. */
interface RowPlacement {
  list: DropList
  reorderable: boolean
}

/** One item of a folder: a chat, or a folder, file, or shortcut. */
type SidebarEntry = { id: string; sortOrder: number; createdAt: number; updatedAt: number } & (
  | { kind: 'chat'; chat: Chat }
  | { kind: 'node'; node: FileNode }
)

/**
 * A folder's chats and Files items as one list: in their shared manual order (newest first on
 * ties), or with `recent`, most recently updated first.
 */
function sidebarEntries(chats: readonly Chat[], items: readonly FileNode[], recent = false): SidebarEntry[] {
  const entries: SidebarEntry[] = [
    ...chats.map((chat) => ({ kind: 'chat' as const, id: chat.id, sortOrder: chat.sortOrder, createdAt: chat.createdAt, updatedAt: chat.updatedAt, chat })),
    ...items.map((node) => ({
      kind: 'node' as const, id: node.id, sortOrder: node.sortOrder ?? 0, createdAt: Date.parse(node.createdAt), updatedAt: Date.parse(node.updatedAt), node,
    })),
  ]
  return entries.sort(recent
    ? (left, right) => right.updatedAt - left.updatedAt
    : (left, right) => left.sortOrder - right.sortOrder || right.createdAt - left.createdAt)
}

/** A chat as the Files item it is, for dragging into a folder in Files. */
function chatDragItem(chat: Chat, sidebar: SidebarState | undefined) {
  return { id: chat.id, kind: 'chat' as const, name: chat.title, parentId: chat.folderId ?? sidebar?.chatsFolderId ?? null }
}

/** Where opening a Files item or a shortcut goes; null when a shortcut's target is in the trash. */
function itemPath(node: FileNode): string | null {
  const target = node.kind === 'shortcut' ? node.target : { kind: node.kind, id: node.id, available: true }
  if (!target?.available) return null
  if (target.kind === 'chat') return `/c/${target.id}`
  if (target.kind === 'folder') return `/files/f/${target.id}`
  return `/files/d/${target.id}`
}

/** A file's or shortcut's file target, for opening beside the main view. */
function fileTargetId(node: FileNode): string | null {
  if (node.kind === 'doc' || node.kind === 'blob') return node.id
  if (node.kind === 'shortcut' && node.target?.available && (node.target.kind === 'doc' || node.target.kind === 'blob')) return node.target.id
  return null
}

/**
 * The actions of a folder, file, or shortcut in the sidebar, from its "⋯" button or a right-click
 * (`atPointer`). `folder` adds the folder actions.
 */
function ItemMenu({ node, folder, sidebar, atPointer = false, onRename, onNewFolder, go }: {
  node: FileNode
  folder?: boolean
  sidebar: SidebarState
  atPointer?: boolean
  onRename: () => void
  onNewFolder: (parentId: string) => void
  go: (path: string) => void
}) {
  const { t } = useTranslation()
  const renameChosen = useRef(false)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const goMain = useMainNavigate()
  const splitAvailable = useSidePanel((state) => state.splitAvailable)
  const system = Boolean(node.systemRole)
  const shortcut = node.kind === 'shortcut'
  const archived = isWithin(sidebar, node.id, sidebar.archiveFolderId)
  const path = itemPath(node)
  const opens = path && (filesEnabled || !path.startsWith('/files')) ? path : null
  const besideId = fileTargetId(node)
  const parentId = node.parentId === sidebar.chatsFolderId ? null : node.parentId
  return (
    <DropdownMenuContent
      side={atPointer ? 'bottom' : 'right'}
      align="start"
      sideOffset={atPointer ? 2 : undefined}
      className="w-52"
      // Start the inline rename only once the menu has closed: the modal menu traps focus
      // until then and would pull it back out of the input. Keep focus off the trigger, too.
      onCloseAutoFocus={(event) => {
        if (!renameChosen.current) return
        renameChosen.current = false
        event.preventDefault()
        onRename()
      }}
    >
      {folder && !shortcut && (
        <DropdownMenuItem onClick={() => onNewFolder(node.id)}>
          <FolderPlus />
          {ui("New folder inside")}
        </DropdownMenuItem>
      )}
      {opens && (
        <DropdownMenuItem onClick={() => go(opens)}>
          <FolderOpen />
          {folder ? ui("Open in Files") : ui("Open")}
        </DropdownMenuItem>
      )}
      {/* The desktop app has no tabs. */}
      {opens && !isDesktopRuntime() && (
        <DropdownMenuItem onClick={() => { window.open(opens, '_blank', 'noopener') }}>
          <ExternalLink />
          {ui("Open in new tab")}
        </DropdownMenuItem>
      )}
      {besideId && splitAvailable && (
        <DropdownMenuItem onClick={() => openBeside({ kind: 'file', id: besideId }, goMain)}>
          <PanelRight />
          {ui("Open to the right")}
        </DropdownMenuItem>
      )}
      {/* The Sidebar folder is the sidebar itself; Archive can be pinned like any folder. */}
      <DropdownMenuItem disabled={node.systemRole === 'chats'} onClick={() => void pinSidebarItems([node.id], !node.pinned, [node])}>
        {node.pinned ? <PinOff /> : <Pin />}
        {node.pinned ? t('chat.unpin') : t('chat.pin')}
      </DropdownMenuItem>
      {/* Built-in folders list the actions they do not allow, unavailable, as in Files. */}
      <DropdownMenuItem disabled={system} onClick={() => { renameChosen.current = true }}>
        <Pencil />
        {t('common.rename')}
      </DropdownMenuItem>
      {!shortcut && (
        <DropdownMenuItem disabled={system} onClick={() => editAppearance([node])}>
          <Palette />
          {ui("Color and icon…")}
        </DropdownMenuItem>
      )}
      {!system && (
        <MoveToFolderSub
          sidebar={sidebar}
          current={parentId}
          // A folder cannot go inside itself.
          blocked={(folderId) => isWithin(sidebar, folderId, node.id)}
          onMove={(folderId) => void moveSidebarSelection([node.id], folderId)}
          onOther={() => void moveInteractively([node], sidebar, node.parentId ?? sidebar.chatsFolderId)}
        />
      )}
      {!shortcut && (
        <DropdownMenuItem onClick={() => void createShortcutInteractively('file', node.id)}>
          <SquareArrowOutUpRight />
          {ui("Create shortcut…")}
        </DropdownMenuItem>
      )}
      {!archived && filesEnabled && (
        <DropdownMenuItem disabled={system} onClick={() => void archiveSidebarSelection([node.id])}>
          <Archive />
          {ui("Move to archive")}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={system} onClick={() => void trashSidebarSelection([node.id])}>
        <Trash2 />
        {trashLabel(node, filesEnabled, t('common.delete'))}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

/** Where a right-click on empty sidebar space opened its menu: the top level (null) or a folder. */
type SpaceMenu = { x: number; y: number; folderId: string | null }

/**
 * The menu for empty space at the top level of the sidebar (the Chats folder) or inside an open
 * folder, like the empty-space menu in Files. Sorting applies to the top level only.
 */
function SpaceMenuContent({ folderId, onNewChat, onNewFolder, onUpload, go }: {
  folderId: string
  /** Given at the top level only, with the sort choice. */
  onNewChat?: () => void
  onNewFolder: () => void
  onUpload: () => void
  go: (path: string) => void
}) {
  const { t } = useTranslation()
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const clip = useFileClipboard((state) => state.clip)
  const ops = useFileOperations()
  const recentOrder = useSettings((state) => state.chatSortMode === 'recent')
  const setSetting = useSettings((state) => state.set)
  const paste = async () => {
    if (!clip) return
    if (clip.mode === 'cut') {
      useFileClipboard.setState({ clip: null })
      await ops.move(clip.nodes, folderId)
    } else {
      await ops.copy(clip.nodes, folderId)
    }
    await refreshSidebar()
  }
  return (
    <DropdownMenuContent side="bottom" align="start" sideOffset={2} className="w-52">
      {onNewChat && (
        <DropdownMenuItem onClick={onNewChat}>
          <SquarePen />
          {t('chat.newChat')}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onNewFolder}>
        <FolderPlus />
        {t('sidebar.newFolder')}
      </DropdownMenuItem>
      {filesEnabled && (
        <>
          <DropdownMenuItem onClick={() => void newSidebarFile(folderId).then((node) => { if (node) go(`/files/d/${node.id}`) })}>
            <FilePlus2 />
            {ui("New file")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onUpload}>
            <Upload />
            {ui("Upload files")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!clip} onClick={() => void paste()}>
            <ClipboardPaste />
            {clip ? (clip.nodes.length === 1 ? uit`Paste "${clip.nodes[0]!.name}"` : uit`Paste ${clip.nodes.length} items`) : ui("Paste")}
          </DropdownMenuItem>
        </>
      )}
      {onNewChat && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowDownUp />
              {ui("Sort by")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={recentOrder ? 'recent' : 'default'} onValueChange={(mode) => setSetting('chatSortMode', mode as ChatSortMode)}>
                <DropdownMenuRadioItem value="default">{t('sidebar.chatSort.default')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="recent">{t('sidebar.chatSort.recent')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      )}
      {filesEnabled && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => go(`/files/f/${folderId}`)}>
            <FolderOpen />
            {ui("Open in Files")}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  )
}

/** The actions for several selected rows, from right-clicking one of them. */
function SelectionMenuContent({ ids, sidebar, onDone }: { ids: string[]; sidebar: SidebarState; onDone: () => void }) {
  const { t } = useTranslation()
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const trashRetention = useSettings((state) => state.trashRetention)
  // A selected folder cannot go inside itself.
  const holdsSelected = (folderId: string) => ids.some((id) => isWithin(sidebar, folderId, id))
  const move = (folderId: string | null) => {
    void moveSidebarSelection(ids, folderId)
    onDone()
  }
  const moveElsewhere = () => {
    onDone()
    void moveInteractively(ids.map((id) => ({ id, name: '' })), sidebar, sidebar.chatsFolderId)
  }
  // Files and folders among the selection can be given a color and icon; chats are left out.
  const styled = ids.flatMap((id) => findSidebarItem(id) ?? []).filter(hasAppearance)
  // Pins whatever is not pinned yet; once everything is, unpins it all.
  const chats = new Map(useChat.getState().chats.map((chat) => [chat.id, chat]))
  const pinning = ids.some((id) => !(chats.get(id)?.pinned ?? findSidebarItem(id)?.pinned))
  return (
    <DropdownMenuContent side="bottom" align="start" sideOffset={2} className="w-52">
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{uit`${ids.length} selected`}</DropdownMenuLabel>
      <DropdownMenuItem onClick={() => { void pinSidebarItems(ids, pinning); onDone() }}>
        {pinning ? <Pin /> : <PinOff />}
        {pinning ? t('chat.pin') : t('chat.unpin')}
      </DropdownMenuItem>
      <MoveToFolderSub sidebar={sidebar} blocked={holdsSelected} onMove={move} onOther={moveElsewhere} />
      {styled.length > 0 && (
        <DropdownMenuItem onClick={() => editAppearance(styled)}>
          <Palette />
          {ui("Color and icon…")}
        </DropdownMenuItem>
      )}
      {filesEnabled && (
        <DropdownMenuItem onClick={() => { void archiveSidebarSelection(ids); onDone() }}>
          <Archive />
          {ui("Move to archive")}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => { void trashSidebarSelection(ids); onDone() }}>
        <Trash2 />
        {trashRetention === 'instant' ? t('common.delete') : ui("Move to trash")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

/** A right-click menu at the pointer, with the same styling as the "⋯" menus. */
function PointerMenu({ point, onClose, children }: { point: { x: number; y: number } | null; onClose: () => void; children: ReactNode }) {
  if (!point) return null
  return (
    <DropdownMenu key={`${point.x}:${point.y}`} open onOpenChange={(open) => { if (!open) onClose() }} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: point.x, top: point.y }} />
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  )
}

/** A file, or a shortcut to a file or chat, in the sidebar. Opens the way it does from Files. */
function SidebarItemRow({ node, list, reorderable, sidebar, chatId, drag, onDrop, onNewFolder, go, ...props }: LoadedTreeProps & RowPlacement & { node: FileNode }) {
  const { t } = useTranslation()
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const goMain = useMainNavigate()
  const splitAvailable = useSidePanel((state) => state.splitAvailable)
  const path = itemPath(node)
  const besideId = fileTargetId(node)
  const lines = drag.rowLines(list, node.id, 'item')
  const active = node.kind === 'shortcut' && node.target?.kind === 'chat' && node.target.id === chatId
  const selection = props.selection(node.id)
  const menu = (atPointer: boolean) => (
    <ItemMenu node={node} sidebar={sidebar} atPointer={atPointer} onRename={() => setRenaming(true)} onNewFolder={onNewFolder} go={go} />
  )
  return (
    <div
      data-drag-list={reorderable ? list : undefined}
      data-drag-id={reorderable ? node.id : undefined}
      data-sidebar-select={node.id}
      draggable={!renaming}
      onDragStart={(e) => drag.startDrag('item', node.id, e, list, node)}
      onDragEnd={drag.clearDrag}
      onDragOver={reorderable ? (e) => drag.onRowDragOver(list, node.id, e) : undefined}
      onDrop={onDrop}
      onContextMenu={(event) => {
        if (renaming || selection.onContextMenu(event)) return
        event.preventDefault()
        setMenuPoint({ x: event.clientX, y: event.clientY })
      }}
      title={path ? undefined : ui("The item this shortcut opens is in the trash")}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
        selection.selected && SELECTED_ROW,
        lines.dragging && 'opacity-40',
        !path && 'opacity-60',
      )}
    >
      <DropLines active before={lines.showLineBefore} after={lines.showLineAfter} />
      <FileNodeIcon node={node} className="size-4" />
      {renaming ? (
        <InlineTitleInput value={node.name} label={t('common.rename')} onCommit={(next) => void renameSidebarItem(node.id, next)} onDone={() => setRenaming(false)} />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 cursor-[inherit] truncate text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
          onClick={(event) => {
            if (drag.didDragRef.current) {
              drag.didDragRef.current = false
              return
            }
            // Shortcuts to trashed items cannot open, but can still be selected.
            if (selection.onClick(event) || !path) return
            if (event.altKey && besideId && splitAvailable) openBeside({ kind: 'file', id: besideId }, goMain)
            else go(path)
          }}
        >
          {node.name}
        </button>
      )}
      {props.shiftHeld && <QuickTrashButton label={trashLabel(node, filesEnabled, t('common.delete'))} onClick={() => void trashSidebarSelection([node.id])} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'relative invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible data-[state=open]:visible',
              props.shiftHeld && 'group-hover:hidden',
            )}
            aria-label={ui("Item options")}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        {menu(false)}
      </DropdownMenu>
      <PointerMenu point={menuPoint} onClose={() => setMenuPoint(null)}>{menu(true)}</PointerMenu>
    </div>
  )
}

/** One item of a folder, whatever it is, at its place in the folder's list. */
function SidebarEntryRow({ entry, list, reorderable, ...props }: TreeProps & RowPlacement & { entry: SidebarEntry }) {
  const { drag, chatId, shiftHeld, onNavigate, onDrop } = props
  if (entry.kind === 'chat') {
    const chat = entry.chat
    return (
      <ChatRow
        chat={chat}
        active={chat.id === chatId}
        shiftHeld={shiftHeld}
        onNavigate={onNavigate}
        draggable
        // Rows in recent order cannot be rearranged, so drags over them fall through to the
        // sidebar handler, which targets the top of the list as a whole.
        droppable={reorderable}
        {...drag.rowLines(list, chat.id, 'chat')}
        didDragRef={drag.didDragRef}
        dragList={reorderable ? list : undefined}
        onDragStart={(e) => drag.startDrag('chat', chat.id, e, list, chatDragItem(chat, props.sidebar))}
        onDragOver={reorderable ? (e) => drag.onRowDragOver(list, chat.id, e) : undefined}
        onDrop={reorderable ? onDrop : undefined}
        onDragEnd={drag.clearDrag}
        selection={props.selection(chat.id)}
      />
    )
  }
  const node = entry.node
  const { sidebar } = props
  if (!sidebar) return null
  if (node.kind === 'folder') {
    return <SidebarFolderNode folder={{ id: node.id, name: node.name, systemRole: node.systemRole ?? null }} node={node} list={list} reorderable={reorderable} {...props} sidebar={sidebar} />
  }
  // A shortcut to a folder opens in place, like the folder itself.
  if (node.kind === 'shortcut' && node.target?.kind === 'folder' && node.target.available) {
    const target = { id: node.target.id, name: node.name, systemRole: node.target.systemRole }
    return <SidebarFolderNode folder={target} node={node} shortcut={node} list={list} reorderable={reorderable} {...props} sidebar={sidebar} />
  }
  return <SidebarItemRow node={node} list={list} reorderable={reorderable} {...props} sidebar={sidebar} />
}

/**
 * A Files folder in the sidebar and, once open, its items (chats included) in their shared order.
 * Things dragged onto it move into it, and so do items dragged here from Files.
 * With `shortcut`, this is a shortcut to the folder: it opens the folder, but dragging, renaming,
 * and deleting act on the shortcut.
 */
function SidebarFolderNode({ folder, node, shortcut, list, reorderable, ...props }: LoadedTreeProps & RowPlacement & {
  folder: { id: string; name: string; systemRole: SidebarFolder['systemRole'] }
  /** The Files item this row is: the folder, or the shortcut to it. */
  node: FileNode
  shortcut?: FileNode
}) {
  const { t } = useTranslation()
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const { sidebar, chatsByFolder, drag, onDrop, onNewFolder, newFolderId, onNewFolderNamed, go } = props
  // A shortcut opens independently of the folder it points at.
  const expansionKey = shortcut ? `shortcut:${shortcut.id}` : folder.id
  const expanded = useFolderExpansion((state) => state.expanded[expansionKey] ?? false)
  const setExpanded = useFolderExpansion((state) => state.setExpanded)
  const items = useSidebarItems(folder.id, expanded).data ?? []
  const [renamingState, setRenaming] = useState(false)
  // A new folder starts out renaming, as in Files.
  const renaming = renamingState || (!shortcut && newFolderId === folder.id)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const chats = chatsByFolder.get(folder.id) ?? []
  const contentsList = folderListId(folder.id)
  const dragged = shortcut ? { kind: 'item' as const, id: shortcut.id } : folder.systemRole ? null : { kind: 'folder' as const, id: folder.id }
  const rowId = dragged?.id ?? folder.id
  // Built-in folders cannot be moved or trashed, so they are not selectable either.
  const selection = dragged ? props.selection(rowId) : undefined
  const lines = drag.rowLines(list, rowId, dragged?.kind ?? 'folder')
  const dropHighlight = drag.drop?.kind === 'folder-target' && drag.drop.folderId === folder.id
  const FolderGlyph = folder.systemRole === 'archive' ? Archive : FolderIcon
  const menuNode = shortcut ?? node
  const menu = (atPointer: boolean) => (
    <ItemMenu node={menuNode} folder sidebar={sidebar} atPointer={atPointer} onRename={() => setRenaming(true)} onNewFolder={onNewFolder} go={go} />
  )
  const entries = sidebarEntries(chats, items)

  return (
    <div>
      <div
        data-drag-list={reorderable ? list : undefined}
        data-drag-id={reorderable ? rowId : undefined}
        draggable={Boolean(dragged) && !renaming}
        onDragStart={dragged ? (e) => drag.startDrag(dragged.kind, dragged.id, e, list, node) : undefined}
        onDragEnd={dragged ? drag.clearDrag : undefined}
        onDragOver={(e) => drag.onFolderDragOver(folder.id, e, reorderable ? { list, id: rowId } : undefined)}
        onDrop={onDrop}
        data-folder-row={folder.id}
        data-sidebar-select={selection ? rowId : undefined}
        onContextMenu={(event) => {
          if (renaming || selection?.onContextMenu(event)) return
          event.preventDefault()
          setMenuPoint({ x: event.clientX, y: event.clientY })
        }}
        className={cn(
          'group relative flex items-center rounded-lg text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70',
          selection?.selected && SELECTED_ROW,
          dragged && 'active:cursor-grabbing',
          lines.dragging && 'opacity-40',
          dropHighlight && 'bg-sidebar-accent ring-1 ring-foreground/20',
        )}
      >
        <DropLines active before={lines.showLineBefore} after={lines.showLineAfter} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5">
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
          {shortcut || node.color || node.icon
            ? <FileNodeIcon node={shortcut ?? node} className="size-4" />
            : <FolderGlyph className="size-4 shrink-0 text-muted-foreground" />}
          {renaming ? (
            <InlineTitleInput
              value={shortcut?.name ?? folder.name}
              label={t('sidebar.renameFolder')}
              onCommit={(next) => void renameSidebarItem(shortcut?.id ?? folder.id, next)}
              onDone={() => {
                setRenaming(false)
                if (newFolderId === folder.id) onNewFolderNamed()
              }}
            />
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              className="flex-1 cursor-pointer truncate text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
              onClick={(event) => {
                if (drag.didDragRef.current) {
                  drag.didDragRef.current = false
                  return
                }
                if (selection?.onClick(event)) return
                setExpanded(expansionKey, !expanded)
              }}
            >
              {shortcut?.name ?? folder.name}
            </button>
          )}
        </div>
        {/* Built-in folders cannot be trashed. */}
        {props.shiftHeld && dragged && (
          <QuickTrashButton label={trashLabel(menuNode, filesEnabled, t('common.delete'))} onClick={() => void trashSidebarSelection([menuNode.id])} />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'relative invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible data-[state=open]:visible',
                props.shiftHeld && dragged && 'group-hover:hidden',
              )}
              aria-label={t('sidebar.folderOptions')}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          {menu(false)}
        </DropdownMenu>
        <span className="mr-2 min-w-3 text-right text-xs text-muted-foreground">{chats.length || ''}</span>
        <PointerMenu point={menuPoint} onClose={() => setMenuPoint(null)}>{menu(true)}</PointerMenu>
      </div>
      {expanded && (
        <div
          className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2"
          data-folder-body={folder.id}
          onContextMenu={(event) => props.onSpaceMenu(event, folder.id)}
          onDragOver={(e) => drag.onFolderBodyDragOver(folder.id, e)}
          onDrop={onDrop}
        >
          {entries.map((entry) => <SidebarEntryRow key={entry.id} entry={entry} list={contentsList} reorderable {...props} />)}
          {entries.length === 0 && (
            <div className={cn('rounded-md px-2 py-1 text-xs text-muted-foreground', dropHighlight && 'bg-sidebar-accent/80 text-foreground')}>
              {dropHighlight ? t('sidebar.dropToAdd') : t('sidebar.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Sidebar({
  collapsed,
  mobile,
  mobileOpen,
  transitions = true,
  onToggle,
  onNavigate,
  onOpenSearch,
  onOpenSettings,
}: {
  collapsed: boolean
  mobile: boolean
  mobileOpen: boolean
  transitions?: boolean
  onToggle: () => void
  onNavigate: () => void
  onOpenSearch: () => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { chatId } = useParams()
  const recentOrder = useSettings((s) => s.chatSortMode === 'recent')
  // Rows render from a non-reactive snapshot below, so this key must cover every chat field they display or sort by.
  const chatListRevision = useChat((state) => state.chats.map((chat) => (
    `${chat.id}:${chat.title}:${chat.pinned}:${chat.folderId ?? ''}:${chat.modelId}:${chat.sortOrder}:${chat.temporary}:${chat.expiresAt ?? ''}:${recentOrder ? chat.updatedAt : ''}`
  )).join('|'))
  void chatListRevision
  const chats = useChat.getState().chats.filter((chat) => !chat.temporary)
  const activeTemporaryChatId = useChat((state) => state.activeTemporaryChatId)
  const composerModelId = useChat((state) => state.composerModelId)
  const sidebar = useSidebarState().data
  const setFolderExpanded = useFolderExpansion((s) => s.setExpanded)
  const user = useAuth((s) => s.user)
  const instanceReady = useAuth((s) => s.instanceReady)
  const networkReady = !isDesktopRuntime() || instanceReady
  const pendingFriendsQuery = useQuery({
    queryKey: ['friends-pending-count', user?.id],
    queryFn: () => apiRequest<{ count: number }>('/api/friends/pending-count'),
    enabled: Boolean(networkReady && user?.id && user.role !== 'pending'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const pendingPoolsQuery = useQuery({
    queryKey: ['pool-pending-count', user?.id],
    queryFn: () => apiRequest<{ count: number }>('/api/pools/pending-count'),
    enabled: Boolean(networkReady && user?.id && user.role !== 'pending'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const pendingSocialCount = (pendingFriendsQuery.data?.count ?? 0) + (pendingPoolsQuery.data?.count ?? 0)
  const apiKeysEnabled = useAuth((s) => s.apiKeysEnabled)
  const filesEnabled = useAuth((s) => s.filesEnabled)
  const billingEnabled = useAuth((s) => s.billingEnabled)
  const billingQuery = useQuery({
    queryKey: ['billing', user?.id],
    queryFn: fetchBillingSummary,
    enabled: Boolean(networkReady && billingEnabled && user?.id && user.role !== 'pending'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const billingPlan = billingEnabled ? billingQuery.data?.plan : undefined
  const sidebarPins = useSettings((s) => s.sidebarPins)
  const setSetting = useSettings((s) => s.set)
  const signOutActiveAccount = useAuth((s) => s.signOutActiveAccount)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [newFolderId, setNewFolderId] = useState<string | null>(null)
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const [filesMenuPoint, setFilesMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const shiftHeld = useShiftHeld()
  const folderOfList = (list: DropList): string | null => {
    if (list === 'pinned') return null
    if (list === 'loose') return sidebar?.chatsFolderId ?? null
    return list.slice('folder:'.length)
  }
  // Rows selected with Cmd/Ctrl- and Shift-clicks, to drag, move, or trash together as in Files.
  const [selection, setSelection] = useState<FileSelection>(EMPTY_SELECTION)
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  /** The selectable rows, top to bottom, as the sidebar shows them. */
  const selectableIds = () => [...new Set(Array.from(
    asideRef.current?.querySelectorAll<HTMLElement>('[data-sidebar-select]') ?? [],
    (row) => row.dataset.sidebarSelect!,
  ))]
  /** The selected rows still shown, in sidebar order. */
  const selectedIds = () => selectableIds().filter((id) => selection.ids.has(id))
  const dragItem = (id: string): SidebarDragItem | undefined => {
    const chat = chats.find((candidate) => candidate.id === id)
    return chat ? chatDragItem(chat, sidebar) : findSidebarItem(id)
  }
  const rowSelection = (id: string): RowSelection => ({
    selected: selection.ids.has(id),
    onClick: (event) => {
      const toggle = event.metaKey || event.ctrlKey
      if (!toggle && !event.shiftKey) {
        if (selection.ids.size) setSelection(EMPTY_SELECTION)
        return false
      }
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      const order = selectableIds()
      // Starting from nothing, the open chat counts as selected, so Shift-click spans from it.
      const base = selection.ids.size === 0 && chatId && order.includes(chatId) ? selectOnly(chatId) : selection
      setSelection(clickSelect(base, order, id, { toggle, range: event.shiftKey }))
      return true
    },
    onContextMenu: (event) => {
      if (sidebar && selection.ids.has(id) && selection.ids.size > 1) {
        event.preventDefault()
        setSelectionMenu({ x: event.clientX, y: event.clientY, ids: selectedIds() })
        return true
      }
      // Right-clicking a row outside the selection acts on that row alone.
      if (selection.ids.size) setSelection(EMPTY_SELECTION)
      return false
    },
  })
  useEffect(() => {
    if (!selection.ids.size) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isEditableTarget(event.target)) setSelection(EMPTY_SELECTION)
    }
    // Clicking outside the sidebar (its menus aside) ends the selection.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || asideRef.current?.contains(target) || target.closest('[role="menu"]')) return
      setSelection(EMPTY_SELECTION)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [selection])
  const drag = useSidebarDrag({
    canEnter: (id, folderId) => !isWithin(sidebar, folderId, id),
    folderOfList,
    groupOf: (id) => {
      if (!selection.ids.has(id) || selection.ids.size < 2) return null
      const items = selectedIds().flatMap((selected) => dragItem(selected) ?? [])
      return items.length > 1 ? items : null
    },
  })
  const pinnedZoneRef = useRef<HTMLDivElement>(null)
  const openSidebarLabel = t('sidebar.expand')

  const ensureFolderExpanded = (folderId: string) => setFolderExpanded(folderId, true)

  /** Every drop commits exactly what the drop line or highlight showed, wherever the pointer is. */
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const hint = drag.dropRef.current
    const from = drag.dragIdRef.current
    const kind = drag.dragKindRef.current
    const sourceList = drag.dragListRef.current
    const group = drag.groupRef.current
    drag.clearDrag()
    if (!hint || !from || !kind) return
    if (group) {
      dropGroup(hint, group.map((member) => member.id))
      return
    }
    // Pinned items dropped anywhere else leave the pinned list.
    const fromPinned = sourceList === 'pinned'

    // Dropped on a folder, or below everything at the top level: to the top of that folder.
    if (hint.kind === 'folder-target' || hint.kind === 'loose-target') {
      const folderId = hint.kind === 'folder-target' ? hint.folderId : null
      if (hint.kind === 'loose-target' && sourceList === 'loose') return
      void moveSidebarSelection([from], folderId, { unpin: fromPinned })
      if (folderId) ensureFolderExpanded(folderId)
      return
    }
    if (hint.id === from) return
    // Chats, folders, files, and shortcuts share one order in each folder and in the pinned list.
    const ids = listRowIds(hint.list).filter((id) => id !== from)
    placeInList(hint.list, reorderList([...ids, from], from, hint.id, hint.edge))
  }

  /** Saves the order of a folder's list or the pinned list; listed items from elsewhere join it. */
  const placeInList = (list: DropList, ids: string[], incoming?: FileNode[]): boolean => {
    if (list === 'pinned') {
      void orderPinnedItems(ids, incoming)
      return true
    }
    const folderId = folderOfList(list)
    if (!folderId) return false
    void orderSidebarItems(folderId, ids, incoming)
    return true
  }

  /** Puts `ids` together, in their order, at a drop line. */
  const placeAtLine = (hint: Extract<DropHint, { kind: 'row' }>, ids: readonly string[], incoming?: FileNode[]): boolean => {
    const rest = listRowIds(hint.list).filter((id) => !ids.includes(id))
    const at = rest.indexOf(hint.id) + (hint.edge === 'after' ? 1 : 0)
    return placeInList(hint.list, [...rest.slice(0, at), ...ids, ...rest.slice(at)], incoming)
  }

  /** Drops several selected rows together, in their order, where the sidebar showed. */
  const dropGroup = (hint: DropHint, ids: string[]) => {
    if (hint.kind !== 'row') {
      const folderId = hint.kind === 'folder-target' ? hint.folderId : null
      void moveSidebarSelection(ids, folderId, { unpin: true })
      if (folderId) ensureFolderExpanded(folderId)
      return
    }
    if (ids.includes(hint.id)) return
    placeAtLine(hint, ids)
  }

  /** Places items dragged in from the Files browser where the sidebar showed (see useItemDrag). */
  const dropFromFiles = (nodes: FileNode[]): boolean => {
    const hint = drag.dropRef.current
    drag.setDrop(null)
    if (!hint) return false
    const ids = nodes.map((node) => node.id)
    if (hint.kind !== 'row') {
      const folderId = hint.kind === 'folder-target' ? hint.folderId : null
      void moveSidebarSelection(ids, folderId, { unpin: true, nodes })
      return true
    }
    // Several items stay together, in their order, at the spot shown.
    return placeAtLine(hint, ids, nodes)
  }
  const asideRef = useRef<HTMLElement>(null)
  const filesZone = useRef({ dropFromFiles, drag })
  filesZone.current = { dropFromFiles, drag }
  useEffect(() => registerItemDropZone({
    hover: (x, y, nodes) => {
      const aside = asideRef.current
      const element = document.elementFromPoint(x, y)
      if (!aside || !element || !aside.contains(element)) return false
      const { drag: current } = filesZone.current
      current.setDrop(current.filesDropHint(aside, element, y, nodes))
      return true
    },
    drop: (nodes) => filesZone.current.dropFromFiles(nodes),
    leave: () => filesZone.current.drag.setDrop(null),
  }), [])

  const go = (path: string) => {
    navigate(path)
    onNavigate()
  }

  // Right-clicking empty space: rows and folders open their own menus first (preventing this).
  const [spaceMenu, setSpaceMenu] = useState<SpaceMenu | null>(null)
  const openSpaceMenu = (event: ReactMouseEvent, folderId: string | null) => {
    if (event.defaultPrevented || !sidebar) return
    event.preventDefault()
    setSpaceMenu({ x: event.clientX, y: event.clientY, folderId })
  }
  const uploadInput = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string | null>(null)

  const startNewChat = () => {
    useChat.getState().abandonTemporaryChat()
    navigate('/', {
      state: newChatLocationState(Boolean(chatId || activeTemporaryChatId), composerModelId),
    })
    onNavigate()
  }

  useEffect(() => {
    setActiveTooltip(null)
  }, [collapsed])

  // The sidebar is the Chats folder: its chats, folders, files, and shortcuts, as one list.
  const rootItems = useSidebarItems(sidebar?.chatsFolderId).data ?? []
  // Pinned chats and Files items share one order above it, wherever they are in Files.
  const pinnedEntries = sidebarEntries(chats.filter((c) => c.pinned), sidebar?.pinnedItems ?? [])
  // Chats filed in folders show inside them; chats in folders the sidebar does not show stay in Files.
  const inFolders = new Map<string, Chat[]>()
  const loose: Chat[] = []
  for (const c of chats) {
    // Chats at the top of My files are in Files only.
    if (c.pinned || c.inFilesRoot) continue
    if (!c.folderId) loose.push(c)
    else inFolders.set(c.folderId, [...inFolders.get(c.folderId) ?? [], c])
  }
  /**
   * Creates an untitled folder and renames it in place, as in Files. The server picks a free name,
   * so renaming starts once the folder is listed under its final name.
   */
  const newFolder = (parentId?: string) => {
    void createSidebarFolder(ui("Untitled folder"), parentId).then((node) => { if (node) setNewFolderId(node.id) })
  }
  const treeProps: TreeProps = {
    sidebar,
    chatsByFolder: inFolders,
    chatId,
    shiftHeld,
    onNavigate,
    drag,
    onDrop: handleDrop,
    onNewFolder: (parentId: string) => newFolder(parentId),
    newFolderId,
    onNewFolderNamed: () => setNewFolderId(null),
    onSpaceMenu: (event, folderId) => openSpaceMenu(event, folderId),
    selection: rowSelection,
    go,
  }
  // Recent order lists the top level by last activity under time headings; the manual order stays saved underneath.
  const rootEntries = sidebarEntries(loose, rootItems, recentOrder)
  const rootGroups: { group: ChatTimeGroup | null; entries: SidebarEntry[] }[] = []
  if (recentOrder) {
    const byGroup = new Map<ChatTimeGroup, SidebarEntry[]>()
    for (const entry of rootEntries) {
      const group = chatTimeGroup(entry.updatedAt)
      if (!byGroup.has(group)) byGroup.set(group, [])
      byGroup.get(group)!.push(entry)
    }
    for (const group of CHAT_TIME_GROUPS) {
      const entries = byGroup.get(group)
      if (entries) rootGroups.push({ group, entries })
    }
  } else if (rootEntries.length > 0) {
    rootGroups.push({ group: null, entries: rootEntries })
  }
  const toggleChatSortMode = () => setSetting('chatSortMode', recentOrder ? 'default' : 'recent')

  const sidebarContentTransition = !transitions
    ? collapsed
      ? 'pointer-events-none opacity-0 duration-0'
      : 'opacity-100 duration-0'
    : collapsed
      ? 'pointer-events-none opacity-0 duration-100'
      : 'opacity-100 delay-100 duration-150'
  const sidebarTextTransition = cn(
    sidebarContentTransition,
    collapsed ? '-translate-x-1' : 'translate-x-0'
  )

  const navBtn = cn(
    'flex h-8 cursor-pointer items-center overflow-hidden rounded-lg text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/70',
    collapsed ? 'w-9' : 'w-full'
  )

  const iconBtn = (label: string, onClick: () => void, icon: React.ReactNode, badge?: number, onContextMenu?: (event: React.MouseEvent) => void) => (
    <Tooltip
      key={label}
      open={collapsed && activeTooltip === label}
      onOpenChange={(open) => {
        if (collapsed) setActiveTooltip(open ? label : null)
      }}
    >
      <TooltipTrigger asChild>
        <button className={navBtn} onClick={onClick} onContextMenu={onContextMenu} aria-label={label}>
          <span className="relative flex size-8 shrink-0 items-center justify-center">{icon}{Boolean(badge) && <span className="absolute right-0 top-0 grid min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] leading-3.5 text-primary-foreground">{badge! > 99 ? '99+' : badge}</span>}</span>
          <span
            className={cn(
              'min-w-0 truncate whitespace-nowrap pr-2 transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
              sidebarTextTransition
            )}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
    </Tooltip>
  )

  const accountNavItem = (
    key: SidebarPinKey,
    label: string,
    target: string | (() => void),
    icon: React.ReactNode,
    badge?: number,
  ) => {
    const pinned = sidebarPins[key]
    const action = pinned ? 'Unpin' : 'Pin'
    return (
      <div key={key} className="group/account-nav relative">
        <DropdownMenuItem className="w-full pr-9" onClick={() => typeof target === 'string' ? go(target) : target()}>
          {icon}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate">{label}</span>
            {Boolean(badge) && <span className="grid min-w-3.5 shrink-0 place-items-center rounded-full bg-primary px-1 text-[9px] leading-3.5 text-primary-foreground">
              {badge! > 99 ? '99+' : badge}
            </span>}
          </span>
        </DropdownMenuItem>
        <button
          type="button"
          aria-label={uit`${action} ${label} ${pinned ? 'from' : 'to'} sidebar`}
          title={uit`${action} ${label} ${pinned ? 'from' : 'to'} sidebar`}
          className="invisible absolute right-1 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-hidden hover:bg-background/60 hover:text-foreground focus-visible:visible focus-visible:ring-1 focus-visible:ring-ring group-hover/account-nav:visible group-focus-within/account-nav:visible"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setSetting('sidebarPins', toggleSidebarPin(sidebarPins, key))
          }}
        >
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </button>
      </div>
    )
  }

  return (
    <aside
      ref={asideRef}
      onDragOver={(e) => drag.onSidebarDragOver(e, {
        pinnedBottom: pinnedZoneRef.current?.getBoundingClientRect().bottom,
      })}
      onDragLeave={drag.onSidebarDragLeave}
      onDrop={handleDrop}
      aria-label={t('sidebar.sidebar')}
      aria-hidden={mobile && !mobileOpen}
      inert={mobile && !mobileOpen}
      className={cn(
        'flex h-full shrink-0 select-none flex-col overflow-hidden border-r border-sidebar-border bg-sidebar motion-reduce:transition-none',
        mobile
          ? cn(
              'mobile-sidebar fixed inset-y-0 left-0 z-40 w-[min(82vw,320px)] shadow-2xl',
              transitions && 'transition-transform duration-200 ease-out'
            )
          : cn(
              'desktop-sidebar relative z-[41] will-change-[width]',
              transitions &&
                'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]'
            ),
        mobile && !mobileOpen && '-translate-x-full',
        !mobile && (collapsed ? 'desktop-collapsed-sidebar w-[52px]' : 'w-[264px]')
      )}
    >
      {!mobile && isDesktopRuntime() && (
        <div
          aria-hidden="true"
          className={cn(
            'desktop-sidebar-added-border pointer-events-none absolute right-0 top-0 h-4 border-r border-sidebar-border motion-reduce:transition-none',
            transitions && 'transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            collapsed ? 'opacity-0' : 'opacity-100',
          )}
        />
      )}
      {/* header */}
      <div className="flex items-center gap-1 p-2">
        <Tooltip
          open={collapsed && activeTooltip === openSidebarLabel}
          onOpenChange={(open) => {
            if (collapsed) setActiveTooltip(open ? openSidebarLabel : null)
          }}
        >
          <TooltipTrigger asChild>
            <button
              className="group/logo flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-sidebar-accent"
              onClick={collapsed ? onToggle : () => go('/')}
              aria-label={collapsed ? openSidebarLabel : t('sidebar.home')}
            >
              <img
                src="/pulpo-smiley.png"
                alt="Pulpo"
                className={cn('size-6', collapsed && 'group-hover/logo:hidden')}
              />
              {collapsed && <PanelLeftOpen className="hidden size-4 group-hover/logo:block" />}
            </button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">{openSidebarLabel}</TooltipContent>}
        </Tooltip>
        <span
          className={cn(
            'min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold text-sidebar-foreground transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
            sidebarTextTransition
          )}
        >
          Pulpo
          {(billingPlan === 'fat' || billingPlan === 'eight') && (
            <span className="text-violet-600 dark:text-violet-400">
              {' '}{billingPlanTier(billingPlan)}
            </span>
          )}
        </span>
        {!collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                onClick={onToggle}
                aria-label={t('sidebar.collapse')}
              >
                <PanelLeftClose className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.collapse')}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* The complete menu shares one scroll position; the header and account stay anchored. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onContextMenu={(event) => {
          if (!(event.target as Element).closest('[data-sidebar-nav]')) openSpaceMenu(event, null)
        }}
        onClick={(event) => {
          if (selection.ids.size && !(event.target as Element).closest('[data-sidebar-select]')) setSelection(EMPTY_SELECTION)
        }}
      >
        {/* primary nav */}
        <div className="space-y-0.5 px-2" data-sidebar-nav>
          {iconBtn(t('chat.newChat'), startNewChat, <SquarePen className="size-4" />)}
          {sidebarPins.searchChats && iconBtn(t('sidebar.searchChats'), onOpenSearch, <Search className="size-4" />)}
          {filesEnabled && sidebarPins.files && iconBtn(t('sidebar.files'), () => go('/files'), <FolderIcon className="size-4" />, undefined, (event) => {
            event.preventDefault()
            setFilesMenuPoint({ x: event.clientX, y: event.clientY })
          })}
          {sidebarPins.usage && iconBtn(t('sidebar.usage'), () => go('/usage'), <BarChart3 className="size-4" />)}
          {billingEnabled && sidebarPins.billing && iconBtn(t('sidebar.billing'), () => go('/billing'), <CreditCard className="size-4" />)}
          {sidebarPins.friends && iconBtn(t('sidebar.friends'), () => go('/friends'), <UsersRound className="size-4" />, pendingSocialCount)}
          {apiKeysEnabled && sidebarPins.apiKeys && iconBtn(t('sidebar.apiKeys'), () => go('/api-keys'), <KeyRound className="size-4" />)}
          {filesEnabled && <FilesNavMenu point={filesMenuPoint} onClose={() => setFilesMenuPoint(null)} go={go} />}
        </div>

        {/* Secondary content stays mounted so every section animates on one timeline. */}
        <div
          aria-hidden={collapsed}
          className={cn(
            'transition-opacity ease-[cubic-bezier(0.4,0,0.2,1)]',
            collapsed && 'h-0 overflow-hidden',
            sidebarContentTransition
          )}
        >
          {/* chat list */}
          <div className="px-2 pb-4 pt-2">
            {pinnedEntries.length > 0 && (
              <div className="mb-2" ref={pinnedZoneRef} data-pinned-zone>
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('sidebar.pinned')}
                </div>
                <div className="space-y-0.5">
                  {pinnedEntries.map((entry) => (
                    <SidebarEntryRow key={entry.id} entry={entry} list="pinned" reorderable {...treeProps} />
                  ))}
                </div>
              </div>
            )}

            <div
              className={cn(
                'rounded-lg',
                drag.drop?.kind === 'loose-target' && 'bg-sidebar-accent/40 ring-1 ring-foreground/10',
              )}
            >
              <div className="flex items-center px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <button
                  type="button"
                  className="cursor-pointer uppercase tracking-wider underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none"
                  onClick={toggleChatSortMode}
                  aria-label={t('sidebar.chatSort.toggle', {
                    mode: t(recentOrder ? 'sidebar.chatSort.recent' : 'sidebar.chatSort.default'),
                    next: t(recentOrder ? 'sidebar.chatSort.default' : 'sidebar.chatSort.recent'),
                  })}
                >
                  {t(recentOrder ? 'sidebar.chatSort.recent' : 'sidebar.chatSort.default')}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
                      disabled={!sidebar}
                      onClick={() => newFolder()}
                      aria-label={t('sidebar.newFolder')}
                    >
                      <FolderPlus className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t('sidebar.newFolder')}</TooltipContent>
                </Tooltip>
              </div>
              {rootGroups.map(({ group, entries }) => (
                <div key={group ?? 'default'} className={cn(group && group !== rootGroups[0]!.group && 'mt-3')}>
                  {group && (
                    <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground/80">
                      {t(`sidebar.groups.${group}`)}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {entries.map((entry) => (
                      <SidebarEntryRow key={entry.id} entry={entry} list="loose" reorderable={!recentOrder} {...treeProps} />
                    ))}
                  </div>
                </div>
              ))}
              {drag.dragKind !== null && drag.dragList !== 'loose' && (
                <div className="mt-1 px-2 py-2 text-xs text-muted-foreground">
                  {rootEntries.length === 0 ? t('sidebar.dropHere') : ui("Drop here to move to the top")}
                </div>
                )}
              </div>
          </div>
        </div>
      </div>

      {/* user footer */}
      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="relative flex h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg text-left hover:bg-sidebar-accent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <ProfileAvatar name={user?.name ?? 'Pulpo user'} avatarUrl={user?.avatarUrl} className="size-7" fallbackClassName="text-[11px]" />
              </span>
              <div
                className={cn(
                  'min-w-0 flex-1 whitespace-nowrap transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
                  !sidebarPins.friends && pendingSocialCount ? 'pr-8' : 'pr-2',
                  sidebarTextTransition
                )}
              >
                <div className="truncate text-sm font-medium">{user?.name ?? t('sidebar.signedOut')}</div>
                <div className="truncate text-xs text-muted-foreground">{user?.username ? uit`@${user.username}` : ''}</div>
              </div>
              {!sidebarPins.friends && Boolean(pendingSocialCount) && (
                <span className={cn(
                  'absolute grid min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] leading-3.5 text-primary-foreground',
                  collapsed ? 'right-0 top-0' : 'right-2 top-1/2 -translate-y-1/2',
                )}>
                  {pendingSocialCount > 99 ? '99+' : pendingSocialCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <AccountSwitcherMenuItems open={accountMenuOpen} />
            {accountNavItem('searchChats', t('sidebar.searchChats'), onOpenSearch, <Search />)}
            {filesEnabled && accountNavItem('files', t('sidebar.files'), '/files', <FolderIcon />)}
            {accountNavItem('usage', t('sidebar.usage'), '/usage', <BarChart3 />)}
            {accountNavItem('friends', t('sidebar.friends'), '/friends', <UsersRound />, pendingSocialCount)}
            {apiKeysEnabled && accountNavItem('apiKeys', t('sidebar.apiKeys'), '/api-keys', <KeyRound />)}
            {billingEnabled && accountNavItem('billing', t('sidebar.billing'), '/billing', <CreditCard />)}
            {billingEnabled && billingQuery.data?.onHold && (
              <div className="px-3 pb-2 pl-8 text-[11px] text-destructive">{t('sidebar.billingOnHold')}</div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings />
              {t('sidebar.settings')}
            </DropdownMenuItem>
            {user?.role === 'admin' && (
              <DropdownMenuItem onClick={() => go('/admin')}>
                <ShieldCheck />
                {t('sidebar.adminPanel')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                onNavigate()
                void signOutActiveAccount().then((switched) => { if (!switched) navigate('/login') })
              }}
            >
              <LogOut />
              {t('sidebar.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <FolderPickerDialog />
      <AppearanceDialog />
      <PointerMenu point={spaceMenu} onClose={() => setSpaceMenu(null)}>
        {spaceMenu && sidebar && (
          <SpaceMenuContent
            folderId={spaceMenu.folderId ?? sidebar.chatsFolderId}
            onNewChat={spaceMenu.folderId ? undefined : startNewChat}
            onNewFolder={() => newFolder(spaceMenu.folderId ?? undefined)}
            onUpload={() => {
              uploadTarget.current = spaceMenu.folderId ?? sidebar.chatsFolderId
              uploadInput.current?.click()
            }}
            go={go}
          />
        )}
      </PointerMenu>
      <PointerMenu point={selectionMenu} onClose={() => setSelectionMenu(null)}>
        {selectionMenu && sidebar && (
          <SelectionMenuContent ids={selectionMenu.ids} sidebar={sidebar} onDone={() => setSelection(EMPTY_SELECTION)} />
        )}
      </PointerMenu>
      <input
        ref={uploadInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...event.target.files ?? []]
          event.target.value = ''
          if (uploadTarget.current) void uploadToSidebar(uploadTarget.current, files)
        }}
      />
    </aside>
  )
}
