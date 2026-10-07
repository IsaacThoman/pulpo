import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  BarChart3,
  BookmarkMinus,
  BookmarkPlus,
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
  Pencil,
  Pin,
  PinOff,
  Plus,
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
  ExternalLink,
} from 'lucide-react'
import type { FileNode, SidebarFolder, SidebarState } from '@pulpo/contracts'
import { cn } from '@/lib/utils'
import { compareChatOrder, useChat } from '@/stores/chat'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { CHAT_TIME_GROUPS, chatTimeGroup, type ChatTimeGroup } from '@/lib/format'
import { resolveChatExpiryMenuAction } from '@/lib/chat-expiration'
import { chatHasStreamingResponse } from '@/lib/response-tracking'
import type { Chat } from '@/lib/types'
import { ExpiryCountdown } from '@/components/chat/ExpiryCountdown'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import { useFileDragActive } from '@/features/files/browser/use-item-drag'
import { useSidePanel } from '@/features/side-panel/store'
import { openBeside, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { reorderList } from '@/lib/model-order'
import {
  SHORTCUTS_DROP_TARGET,
  addShortcut,
  archiveChat,
  archiveFiles,
  childFolders,
  createSidebarFolder,
  folderOutline,
  isWithin,
  moveSidebarFolder,
  removeShortcut,
  renameSidebarFolder,
  reorderShortcuts,
  shortcutFor,
  trashSidebarFolder,
  useFolderExpansion,
  useSidebarFolderFiles,
  useSidebarState,
} from '@/features/sidebar/api'

type DragKind = 'folder' | 'chat' | 'shortcut'
type ChatList = 'pinned' | 'loose' | `folder:${string}`

type DropList = ChatList | 'shortcuts'

type DropHint =
  | { kind: 'row'; list: DropList; id: string; edge: 'before' | 'after' }
  | { kind: 'folder-target'; folderId: string }
  | { kind: 'loose-target' }
  | { kind: 'shortcut-target' }

function sameDropHint(a: DropHint | null, b: DropHint | null) {
  if (!a || !b) return a === b
  if (a.kind === 'row' && b.kind === 'row') {
    return a.list === b.list && a.id === b.id && a.edge === b.edge
  }
  if (a.kind === 'folder-target' && b.kind === 'folder-target') return a.folderId === b.folderId
  return a.kind === b.kind
}

function folderListId(folderId: string): ChatList {
  return `folder:${folderId}`
}

function parseFolderList(list: DropList): string | null {
  return list.startsWith('folder:') ? list.slice('folder:'.length) : null
}

function useSidebarDrag({ canNestFolder }: { canNestFolder: (folderId: string, targetId: string) => boolean }) {
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

  const clearDrag = () => {
    // Browsers send no click after a drag, so the flag only needs to outlive this event.
    window.setTimeout(() => { didDragRef.current = false }, 0)
    dragIdRef.current = null
    dragKindRef.current = null
    dragListRef.current = null
    setDragId(null)
    setDragKind(null)
    setDragList(null)
    setDrop(null)
  }

  const startDrag = (kind: DragKind, id: string, e: DragEvent, list?: DropList) => {
    // Nested rows (a chat inside a folder) must not also start their folder's drag.
    e.stopPropagation()
    didDragRef.current = false
    dragIdRef.current = id
    dragKindRef.current = kind
    dragListRef.current = list ?? null
    setDragId(id)
    setDragKind(kind)
    setDragList(list ?? null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.setData('application/x-pulpo-drag', kind)
  }

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

  /** A folder's header or open body: chats are filed into it, folders are moved into it. */
  const onFolderDragOver = (folderId: string, e: DragEvent<HTMLElement>) => {
    const kind = dragKindRef.current
    const id = dragIdRef.current
    if (!id) return
    if (kind === 'chat') {
      // A chat over its own folder reorders within the folder instead (see onSidebarDragOver).
      if (dragListRef.current === folderListId(folderId)) return
      acceptMove(e)
      setDrop({ kind: 'folder-target', folderId })
      return
    }
    if (kind !== 'folder' || !canNestFolder(id, folderId)) return
    acceptMove(e)
    setDrop({ kind: 'folder-target', folderId })
  }

  const onRowDragOver = (list: DropList, id: string, e: DragEvent<HTMLElement>) => {
    const kind = dragKindRef.current
    if (!dragIdRef.current || dragIdRef.current === id) return
    if (list === 'shortcuts' ? kind !== 'shortcut' : kind !== 'chat') return
    acceptMove(e)
    setDrop({ kind: 'row', list, id, edge: edgeFor(e) })
  }

  /**
   * Everywhere a row does not claim the drag (gaps, headers, empty space, rows of another list),
   * snap to the nearest slot in the dragged item's list. Chats dragged into the pinned area or
   * down into the unfiled area target those lists instead; chats and folders dragged up into the
   * shortcuts area become shortcuts, and folders dragged down to the unfiled area move to the top.
   */
  const onSidebarDragOver = (e: DragEvent<HTMLElement>, zones: { shortcutsBottom?: number; pinnedBottom?: number; looseTop?: number }) => {
    const kind = dragKindRef.current
    const source = dragListRef.current
    if (!kind || !dragIdRef.current) return
    acceptMove(e)
    const inShortcuts = zones.shortcutsBottom !== undefined && e.clientY < zones.shortcutsBottom
    if (kind !== 'shortcut' && inShortcuts) {
      setDrop({ kind: 'shortcut-target' })
      return
    }
    if (kind === 'folder') {
      setDrop(zones.looseTop !== undefined && e.clientY >= zones.looseTop ? { kind: 'loose-target' } : null)
      return
    }
    const list: DropList = kind === 'shortcut'
      ? 'shortcuts'
      : zones.pinnedBottom !== undefined && e.clientY < zones.pinnedBottom
        ? 'pinned'
        : source !== 'loose' && zones.looseTop !== undefined && e.clientY >= zones.looseTop
          ? 'loose'
          : source ?? 'loose'
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-drag-list]'))
      .filter((row) => row.dataset.dragList === list)
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
    const dragged = ids.indexOf(dragIdRef.current)
    // Slots on either side of the dragged row leave it where it is.
    if (dragged >= 0 && (slot === dragged || slot === dragged + 1)) {
      setDrop(null)
      return
    }
    setDrop(slot < rows.length
      ? { kind: 'row', list, id: ids[slot]!, edge: 'before' }
      : { kind: 'row', list, id: ids.at(-1)!, edge: 'after' })
  }

  const onSidebarDragLeave = (e: DragEvent<HTMLElement>) => {
    // Leaving the sidebar cancels the drop, so stop showing where it would land.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
  }

  /** Drop-line props for a row in `list`. */
  const rowLines = (list: DropList, id: string, kind: DragKind) => {
    const isDragging = dragKind === kind && dragId === id
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
    clearDrag,
    startDrag,
    onFolderDragOver,
    onRowDragOver,
    onSidebarDragOver,
    onSidebarDragLeave,
    rowLines,
    dropRef,
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
  const setChatAutoExpiration = useChat((state) => state.setChatAutoExpiration)
  const shareChat = useChat((state) => state.shareChat)
  const deleteChat = useChat((state) => state.deleteChat)
  const moveToFolder = useChat((state) => state.moveToFolder)
  const sidebar = useSidebarState().data
  const outline = folderOutline(sidebar)
  const shortcut = shortcutFor(sidebar, chat.id)
  const archived = Boolean(sidebar && chat.folderId && isWithin(sidebar, chat.folderId, sidebar.archiveFolderId))
  const trashRetention = useSettings((state) => state.trashRetention)
  const automaticChatExpiration = useSettings((state) => state.automaticChatExpiration)
  const expirationMenuAction = resolveChatExpiryMenuAction(chat.expiresAt, automaticChatExpiration)
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
      {expirationMenuAction && (
        <DropdownMenuItem onClick={() => setChatAutoExpiration(chat.id, expirationMenuAction.kind === 'enable')}>
          <Hourglass className={cn(expirationMenuAction.kind === 'disable' && 'text-teal-500 dark:text-teal-400')} />
          {expirationMenuAction.kind === 'disable' && chat.expiresAt !== null
            ? <span>{t('chat.disableExpiry')} <ExpiryCountdown expiresAt={chat.expiresAt} /></span>
            : expirationMenuAction.kind === 'enable' ? expirationMenuAction.label : null}
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput />
          {t('chat.moveToFolder')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
          <DropdownMenuItem disabled={!chat.folderId} onClick={() => moveToFolder(chat.id, null)}>
            {t('chat.noFolder')}
          </DropdownMenuItem>
          {outline.length > 0 && <DropdownMenuSeparator />}
          {outline.map(({ folder, depth }) => (
            <DropdownMenuItem
              key={folder.id}
              disabled={chat.folderId === folder.id}
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
              onClick={() => moveToFolder(chat.id, folder.id)}
            >
              {folder.systemRole === 'archive' ? <Archive /> : <FolderIcon />}
              <span className="truncate">{folder.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {!archived && sidebar && (
        <DropdownMenuItem onClick={() => archiveChat(chat.id)}>
          <Archive />
          {ui("Move to archive")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => void (shortcut ? removeShortcut(shortcut.id) : addShortcut('chat', chat.id))}>
        {shortcut ? <BookmarkMinus /> : <BookmarkPlus />}
        {shortcut ? ui("Remove shortcut") : ui("Add shortcut")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void shareChat(chat.id).then((url) => navigator.clipboard?.writeText(url))}
      >
        <Share2 />
        {t('chat.copyShareLink')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
        <Trash2 />
        {trashRetention === 'instant' ? t('common.delete') : t('chat.trash')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
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
}: {
  chat: Chat
  active: boolean
  shiftHeld: boolean
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
  const deleteChat = useChat((state) => state.deleteChat)
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
      draggable={canDrag && !renaming}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrop || canDrag ? onDragOver : undefined}
      onDrop={canDrop || canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onContextMenu={(event) => {
        if (renaming) return
        event.preventDefault()
        setMenuPoint({ x: event.clientX, y: event.clientY })
      }}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
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
        <button
          className={cn(actionClassName, 'relative hidden hover:text-destructive group-hover:block')}
          onClick={(e) => {
            e.stopPropagation()
            deleteChat(chat.id)
          }}
          aria-label={uit`${trashRetention === 'instant' ? t('common.delete') : t('chat.trash')} chat`}
        >
          <Trash2 className="size-4" />
        </button>
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

/** The actions of a sidebar folder, from its "⋯" button or a right-click (`atPointer`). */
function FolderMenu({ folder, sidebar, atPointer = false, onRename, onNewFolder, go }: {
  folder: SidebarFolder
  sidebar: SidebarState
  atPointer?: boolean
  onRename: () => void
  onNewFolder: (parentId: string) => void
  go: (path: string) => void
}) {
  const { t } = useTranslation()
  const renameChosen = useRef(false)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const system = folder.systemRole !== null
  const archived = isWithin(sidebar, folder.id, sidebar.archiveFolderId)
  const shortcut = shortcutFor(sidebar, folder.id)
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
      <DropdownMenuItem onClick={() => onNewFolder(folder.id)}>
        <FolderPlus />
        {ui("New folder inside")}
      </DropdownMenuItem>
      {!system && (
        <DropdownMenuItem onClick={() => { renameChosen.current = true }}>
          <Pencil />
          {t('common.rename')}
        </DropdownMenuItem>
      )}
      {filesEnabled && (
        <DropdownMenuItem onClick={() => go(`/files/f/${folder.id}`)}>
          <FolderOpen />
          {ui("Open in Files")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => void (shortcut ? removeShortcut(shortcut.id) : addShortcut('file', folder.id))}>
        {shortcut ? <BookmarkMinus /> : <BookmarkPlus />}
        {shortcut ? ui("Remove shortcut") : ui("Add shortcut")}
      </DropdownMenuItem>
      {!system && !archived && (
        <DropdownMenuItem onClick={() => void archiveFiles([folder.id])}>
          <Archive />
          {ui("Move to archive")}
        </DropdownMenuItem>
      )}
      {!system && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void trashSidebarFolder(folder.id)}>
            <Trash2 />
            {filesEnabled ? ui("Move to trash") : t('common.delete')}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  )
}

/** A file in a sidebar folder or shortcut. Opens the way it does from Files. */
function SidebarFileRow({ node, sidebar, go, shortcutId, drag, onDrop }: {
  node: Pick<FileNode, 'id' | 'kind' | 'name' | 'mimeType'>
  sidebar: SidebarState
  go: (path: string) => void
  shortcutId?: string
  drag: SidebarDrag
  onDrop: (e: DragEvent) => void
}) {
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const goMain = useMainNavigate()
  const splitAvailable = useSidePanel((state) => state.splitAvailable)
  const shortcut = shortcutFor(sidebar, node.id)
  const lines = shortcutId ? drag.rowLines('shortcuts', shortcutId, 'shortcut') : null
  return (
    <div
      data-drag-list={shortcutId ? 'shortcuts' : undefined}
      data-drag-id={shortcutId}
      draggable={Boolean(shortcutId)}
      onDragStart={shortcutId ? (e) => drag.startDrag('shortcut', shortcutId, e, 'shortcuts') : undefined}
      onDragOver={shortcutId ? (e) => drag.onRowDragOver('shortcuts', shortcutId, e) : undefined}
      onDrop={shortcutId ? onDrop : undefined}
      onDragEnd={shortcutId ? drag.clearDrag : undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuPoint({ x: event.clientX, y: event.clientY })
      }}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
        lines?.dragging && 'opacity-40',
      )}
    >
      <DropLines active={Boolean(shortcutId)} before={lines?.showLineBefore ?? false} after={lines?.showLineAfter ?? false} />
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-[inherit] items-center gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
        onClick={(event) => {
          if (event.altKey && splitAvailable) openBeside({ kind: 'file', id: node.id }, goMain)
          else go(`/files/d/${node.id}`)
        }}
      >
        <FileNodeIcon node={node} className="size-4" />
        <span className="truncate">{node.name}</span>
      </button>
      {menuPoint && (
        <DropdownMenu key={`${menuPoint.x}:${menuPoint.y}`} open onOpenChange={(open) => { if (!open) setMenuPoint(null) }} modal={false}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menuPoint.x, top: menuPoint.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" sideOffset={2} className="w-52">
            {splitAvailable && (
              <DropdownMenuItem onClick={() => openBeside({ kind: 'file', id: node.id }, goMain)}>
                <PanelRight />
                {ui("Open to the right")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => void (shortcut ? removeShortcut(shortcut.id) : addShortcut('file', node.id))}>
              {shortcut ? <BookmarkMinus /> : <BookmarkPlus />}
              {shortcut ? ui("Remove shortcut") : ui("Add shortcut")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void archiveFiles([node.id])}>
              <Archive />
              {ui("Move to archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/**
 * A Files folder in the sidebar: its subfolders, the chats filed in it, and its files. Chats and
 * folders dragged onto it move into it, and so do items dragged here from Files.
 */
function SidebarFolderNode({
  folder,
  sidebar,
  chatsByFolder,
  chatId,
  shiftHeld,
  onNavigate,
  drag,
  onDrop,
  onNewFolder,
  go,
  shortcutId,
}: {
  folder: SidebarFolder
  sidebar: SidebarState
  chatsByFolder: ReadonlyMap<string, Chat[]>
  chatId?: string
  shiftHeld: boolean
  onNavigate: () => void
  drag: SidebarDrag
  onDrop: (e: DragEvent) => void
  onNewFolder: (parentId: string) => void
  go: (path: string) => void
  /** Set when this is a shortcut's folder: dragging it reorders the shortcuts. */
  shortcutId?: string
}) {
  const { t } = useTranslation()
  // A shortcut opens independently of the same folder elsewhere in the sidebar.
  const expansionKey = shortcutId ? `shortcut:${shortcutId}` : folder.id
  const expanded = useFolderExpansion((state) => state.expanded[expansionKey] ?? (!shortcutId && folder.parentId === sidebar.chatsFolderId))
  const setExpanded = useFolderExpansion((state) => state.setExpanded)
  const fileDropActive = useFileDragActive((state) => state.target === folder.id)
  const files = useSidebarFolderFiles(folder.id, expanded).data ?? []
  const [renaming, setRenaming] = useState(false)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const subfolders = childFolders(sidebar, folder.id)
  const chats = chatsByFolder.get(folder.id) ?? []
  const list = folderListId(folder.id)
  const dragKind: DragKind | null = shortcutId ? 'shortcut' : folder.systemRole ? null : 'folder'
  const lines = shortcutId ? drag.rowLines('shortcuts', shortcutId, 'shortcut') : drag.rowLines(list, folder.id, 'folder')
  const dropHighlight = fileDropActive || (drag.drop?.kind === 'folder-target' && drag.drop.folderId === folder.id)
  const FolderGlyph = folder.systemRole === 'archive' ? Archive : FolderIcon
  const menu = (atPointer: boolean) => (
    <FolderMenu folder={folder} sidebar={sidebar} atPointer={atPointer} onRename={() => setRenaming(true)} onNewFolder={onNewFolder} go={go} />
  )

  return (
    <div>
      <div
        draggable={Boolean(dragKind) && !renaming}
        onDragStart={dragKind ? (e) => drag.startDrag(dragKind, shortcutId ?? folder.id, e, shortcutId ? 'shortcuts' : undefined) : undefined}
        onDragEnd={dragKind ? drag.clearDrag : undefined}
        onDragOver={(e) => {
          if (shortcutId && drag.dragKindRef.current === 'shortcut') drag.onRowDragOver('shortcuts', shortcutId, e)
          else drag.onFolderDragOver(folder.id, e)
        }}
        onDrop={onDrop}
        data-drag-list={shortcutId ? 'shortcuts' : undefined}
        data-drag-id={shortcutId}
        // Items dragged from the Files browser drop here too (see useItemDrag).
        data-drop-target={folder.id}
        onContextMenu={(event) => {
          if (renaming) return
          event.preventDefault()
          setMenuPoint({ x: event.clientX, y: event.clientY })
        }}
        className={cn(
          'group relative flex items-center rounded-lg text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70',
          dragKind && 'active:cursor-grabbing',
          lines.dragging && 'opacity-40',
          dropHighlight && 'bg-sidebar-accent ring-1 ring-foreground/20',
        )}
      >
        <DropLines active={Boolean(shortcutId)} before={lines.showLineBefore} after={lines.showLineAfter} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5">
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
          <FolderGlyph className="size-4 shrink-0 text-muted-foreground" />
          {renaming ? (
            <InlineTitleInput
              value={folder.name}
              label={t('sidebar.renameFolder')}
              onCommit={(next) => void renameSidebarFolder(folder.id, next)}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              className="flex-1 cursor-pointer truncate text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
              onClick={() => {
                if (drag.didDragRef.current) {
                  drag.didDragRef.current = false
                  return
                }
                setExpanded(expansionKey, !expanded)
              }}
            >
              {folder.name}
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="relative invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible data-[state=open]:visible"
              aria-label={t('sidebar.folderOptions')}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          {menu(false)}
        </DropdownMenu>
        <span className="mr-2 min-w-3 text-right text-xs text-muted-foreground">{chats.length || ''}</span>
        {menuPoint && (
          <DropdownMenu key={`${menuPoint.x}:${menuPoint.y}`} open onOpenChange={(open) => { if (!open) setMenuPoint(null) }} modal={false}>
            <DropdownMenuTrigger asChild>
              <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menuPoint.x, top: menuPoint.y }} />
            </DropdownMenuTrigger>
            {menu(true)}
          </DropdownMenu>
        )}
      </div>
      {expanded && (
        <div
          className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2"
          onDragOver={(e) => drag.onFolderDragOver(folder.id, e)}
          onDrop={onDrop}
        >
          {subfolders.map((child) => (
            <SidebarFolderNode
              key={child.id}
              folder={child}
              sidebar={sidebar}
              chatsByFolder={chatsByFolder}
              chatId={chatId}
              shiftHeld={shiftHeld}
              onNavigate={onNavigate}
              drag={drag}
              onDrop={onDrop}
              onNewFolder={onNewFolder}
              go={go}
            />
          ))}
          {chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === chatId}
              shiftHeld={shiftHeld}
              onNavigate={onNavigate}
              draggable
              droppable
              {...drag.rowLines(list, chat.id, 'chat')}
              didDragRef={drag.didDragRef}
              dragList={list}
              onDragStart={(e) => drag.startDrag('chat', chat.id, e, list)}
              onDragOver={(e) => drag.onRowDragOver(list, chat.id, e)}
              onDrop={onDrop}
              onDragEnd={drag.clearDrag}
            />
          ))}
          {files.map((node) => (
            <SidebarFileRow key={node.id} node={node} sidebar={sidebar} go={go} drag={drag} onDrop={onDrop} />
          ))}
          {subfolders.length + chats.length + files.length === 0 && (
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
  const fileDrag = useFileDragActive()
  const setFolderExpanded = useFolderExpansion((s) => s.setExpanded)
  const reorderPinnedChats = useChat((s) => s.reorderPinnedChats)
  const pinChat = useChat((s) => s.pinChat)
  const unpinChat = useChat((s) => s.unpinChat)
  const reorderFolderChats = useChat((s) => s.reorderFolderChats)
  const reorderLooseChats = useChat((s) => s.reorderLooseChats)
  const moveToFolder = useChat((s) => s.moveToFolder)
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
  // The folder a new folder goes into: null for the top of the sidebar, undefined when closed.
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined)
  const [folderName, setFolderName] = useState('')
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const [filesMenuPoint, setFilesMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const shiftHeld = useShiftHeld()
  const drag = useSidebarDrag({
    canNestFolder: (folderId, targetId) => Boolean(sidebar)
      && !isWithin(sidebar, targetId, folderId)
      && sidebar!.folders.find((folder) => folder.id === folderId)?.parentId !== targetId,
  })
  const shortcutsZoneRef = useRef<HTMLDivElement>(null)
  const pinnedZoneRef = useRef<HTMLDivElement>(null)
  const looseZoneRef = useRef<HTMLDivElement>(null)
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
    drag.clearDrag()
    if (!hint || !from) return

    if (hint.kind === 'shortcut-target') {
      if (kind === 'chat' || kind === 'folder') void addShortcut(kind === 'chat' ? 'chat' : 'file', from)
      return
    }
    if (kind === 'shortcut') {
      const ids = sidebar?.shortcuts.map((shortcut) => shortcut.id) ?? []
      if (hint.kind === 'row' && hint.list === 'shortcuts' && hint.id !== from) void reorderShortcuts(reorderList(ids, from, hint.id, hint.edge))
      return
    }
    if (kind === 'folder') {
      if (hint.kind === 'folder-target') void moveSidebarFolder(from, hint.folderId)
      // Dropped on the unfiled list, a folder moves back to the top of the sidebar.
      else if (hint.kind === 'loose-target') void moveSidebarFolder(from, null)
      return
    }
    if (kind !== 'chat') return
    // Pinned chats dropped anywhere else leave the pinned list for the folder or unfiled list they landed in.
    const place = sourceList === 'pinned' ? unpinChat : moveToFolder

    if (hint.kind === 'folder-target') {
      if (sourceList === folderListId(hint.folderId)) return
      place(from, hint.folderId)
      ensureFolderExpanded(hint.folderId)
      return
    }
    if (hint.kind === 'loose-target') {
      if (sourceList !== 'loose') place(from, null)
      return
    }
    if (hint.list === 'shortcuts' || hint.id === from) return
    const position = { targetId: hint.id, edge: hint.edge }
    if (hint.list === 'pinned') {
      if (sourceList === 'pinned') reorderPinnedChats(from, hint.id, hint.edge)
      else pinChat(from, position)
      return
    }
    if (hint.list === 'loose') {
      if (sourceList === 'loose') reorderLooseChats(from, hint.id, hint.edge)
      else place(from, null, position)
      return
    }
    const folderId = parseFolderList(hint.list)
    if (!folderId) return
    if (sourceList === hint.list) {
      reorderFolderChats(folderId, from, hint.id, hint.edge)
    } else {
      place(from, folderId, position)
      ensureFolderExpanded(folderId)
    }
  }

  const go = (path: string) => {
    navigate(path)
    onNavigate()
  }

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

  const topFolders = childFolders(sidebar, sidebar?.chatsFolderId ?? '')
  const shortcuts = sidebar?.shortcuts.filter((shortcut) => shortcut.kind === 'folder' || shortcut.kind === 'chat' || filesEnabled) ?? []
  const pinned = useMemo(() => chats.filter((c) => c.pinned).sort(compareChatOrder), [chats])
  const unpinned = useMemo(() => chats.filter((c) => !c.pinned).sort(compareChatOrder), [chats])
  // Chats filed in folders show inside them; chats in folders the sidebar does not show stay in Files.
  const inFolders = new Map<string, Chat[]>()
  const loose: Chat[] = []
  for (const c of unpinned) {
    if (!c.folderId) loose.push(c)
    else inFolders.set(c.folderId, [...inFolders.get(c.folderId) ?? [], c])
  }
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]))
  const showShortcuts = shortcuts.length > 0 || fileDrag.active
  const shortcutDropActive = fileDrag.target === SHORTCUTS_DROP_TARGET || drag.drop?.kind === 'shortcut-target'
  const folderNodeProps = sidebar && {
    sidebar,
    chatsByFolder: inFolders,
    chatId,
    shiftHeld,
    onNavigate,
    drag,
    onDrop: handleDrop,
    onNewFolder: (parentId: string) => setNewFolderParent(parentId),
    go,
  }
  // Recent order lists unfiled chats by last activity under time headings; drag order stays saved underneath.
  const looseGroups: { group: ChatTimeGroup | null; chats: Chat[] }[] = []
  if (recentOrder) {
    const byGroup = new Map<ChatTimeGroup, Chat[]>()
    for (const c of [...loose].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const group = chatTimeGroup(c.updatedAt)
      if (!byGroup.has(group)) byGroup.set(group, [])
      byGroup.get(group)!.push(c)
    }
    for (const group of CHAT_TIME_GROUPS) {
      const items = byGroup.get(group)
      if (items) looseGroups.push({ group, chats: items })
    }
  } else if (loose.length > 0) {
    looseGroups.push({ group: null, chats: loose })
  }
  const createFolder = () => {
    // Files names cannot contain "/", so it becomes "-" as in the migration of older folders.
    const name = folderName.trim().replaceAll('/', '-')
    if (name) void createSidebarFolder(name, newFolderParent ?? undefined)
    setFolderName('')
    setNewFolderParent(undefined)
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
      onDragOver={(e) => drag.onSidebarDragOver(e, {
        shortcutsBottom: shortcutsZoneRef.current?.getBoundingClientRect().bottom,
        pinnedBottom: pinnedZoneRef.current?.getBoundingClientRect().bottom,
        looseTop: looseZoneRef.current?.getBoundingClientRect().top,
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* primary nav */}
        <div className="space-y-0.5 px-2">
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
            {showShortcuts && (
              <div
                ref={shortcutsZoneRef}
                // Items dragged from the Files browser become shortcuts here (see useItemDrag).
                data-drop-target={SHORTCUTS_DROP_TARGET}
                className={cn('mb-2 rounded-lg', shortcutDropActive && 'bg-sidebar-accent/40 ring-1 ring-foreground/10')}
              >
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {ui("Shortcuts")}
                </div>
                <div className="space-y-0.5">
                  {sidebar && folderNodeProps && shortcuts.map((shortcut) => {
                    if (shortcut.kind === 'folder') {
                      const folder = sidebar.folders.find((item) => item.id === shortcut.targetId)
                      return folder ? <SidebarFolderNode key={shortcut.id} folder={{ ...folder, name: shortcut.name }} shortcutId={shortcut.id} {...folderNodeProps} /> : null
                    }
                    if (shortcut.kind === 'chat') {
                      const chat = chatsById.get(shortcut.targetId)
                      return chat ? (
                        <ChatRow
                          key={shortcut.id}
                          chat={chat}
                          active={chat.id === chatId}
                          shiftHeld={shiftHeld}
                          onNavigate={onNavigate}
                          draggable
                          droppable
                          {...drag.rowLines('shortcuts', shortcut.id, 'shortcut')}
                          didDragRef={drag.didDragRef}
                          dragList="shortcuts"
                          dragId={shortcut.id}
                          onDragStart={(e) => drag.startDrag('shortcut', shortcut.id, e, 'shortcuts')}
                          onDragOver={(e) => drag.onRowDragOver('shortcuts', shortcut.id, e)}
                          onDrop={handleDrop}
                          onDragEnd={drag.clearDrag}
                        />
                      ) : null
                    }
                    return (
                      <SidebarFileRow
                        key={shortcut.id}
                        node={{ id: shortcut.targetId, kind: shortcut.kind, name: shortcut.name, mimeType: null }}
                        sidebar={sidebar}
                        go={go}
                        shortcutId={shortcut.id}
                        drag={drag}
                        onDrop={handleDrop}
                      />
                    )
                  })}
                  {shortcuts.length === 0 && (
                    <div className="rounded-md px-2 py-1.5 text-xs text-muted-foreground">{ui("Drop here to add a shortcut")}</div>
                  )}
                </div>
              </div>
            )}

            {pinned.length > 0 && (
              <div className="mb-2" ref={pinnedZoneRef}>
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('sidebar.pinned')}
                </div>
                <div className="space-y-0.5">
                  {pinned.map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      active={c.id === chatId}
                      shiftHeld={shiftHeld}
                      onNavigate={onNavigate}
                      draggable
                      droppable
                      {...drag.rowLines('pinned', c.id, 'chat')}
                      dragging={drag.dragKind === 'chat' && drag.dragList === 'pinned' && drag.dragId === c.id}
                      didDragRef={drag.didDragRef}
                      dragList="pinned"
                      onDragStart={(e) => drag.startDrag('chat', c.id, e, 'pinned')}
                      onDragOver={(e) => drag.onRowDragOver('pinned', c.id, e)}
                      onDrop={handleDrop}
                      onDragEnd={drag.clearDrag}
                    />
                  ))}
                </div>
              </div>
            )}

            {folderNodeProps && topFolders.map((folder) => (
              <SidebarFolderNode key={folder.id} folder={folder} {...folderNodeProps} />
            ))}

            <button
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground disabled:cursor-default disabled:opacity-50"
              disabled={!sidebar}
              onClick={() => setNewFolderParent(null)}
            >
              <Plus className="size-3.5" /> {t('sidebar.newFolder')}
            </button>

            <div
              className={cn(
                'rounded-lg',
                ((drag.drop?.kind === 'loose-target' && drag.dragKind !== null) || (sidebar && fileDrag.target === sidebar.chatsFolderId))
                  && 'bg-sidebar-accent/40 ring-1 ring-foreground/10',
              )}
              // Items dragged from Files land at the top of the sidebar (in the Chats folder).
              data-drop-target={sidebar?.chatsFolderId}
              ref={looseZoneRef}
            >
              {loose.length > 0 && (
                <div className="mt-3">
                  <div className="flex px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                  </div>
                  {looseGroups.map(({ group, chats: items }) => (
                    <div key={group ?? 'default'} className={cn(group && group !== looseGroups[0]!.group && 'mt-3')}>
                      {group && (
                        <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground/80">
                          {t(`sidebar.groups.${group}`)}
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {items.map((c) => (
                          <ChatRow
                            key={c.id}
                            chat={c}
                            active={c.id === chatId}
                            shiftHeld={shiftHeld}
                            onNavigate={onNavigate}
                            draggable
                            // Recent order cannot be rearranged, so drags over these rows fall through to the
                            // sidebar handler, which targets the unfiled list as a whole.
                            droppable={!recentOrder}
                            {...drag.rowLines('loose', c.id, 'chat')}
                            didDragRef={drag.didDragRef}
                            dragList={recentOrder ? undefined : 'loose'}
                            onDragStart={(e) => drag.startDrag('chat', c.id, e, 'loose')}
                            onDragOver={recentOrder ? undefined : (e) => drag.onRowDragOver('loose', c.id, e)}
                            onDrop={recentOrder ? undefined : handleDrop}
                            onDragEnd={drag.clearDrag}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {loose.length === 0 && drag.dragKind === 'chat' && drag.dragList !== 'loose' && (
                <div className="mt-3 px-2 py-2 text-xs text-muted-foreground">
                  {t('sidebar.dropHere')}
                </div>
              )}
              {drag.dragKind === 'folder' && (
                <div className="mt-3 px-2 py-2 text-xs text-muted-foreground">
                  {ui("Drop here to move to the top")}
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

      <Dialog open={newFolderParent !== undefined} onOpenChange={(open) => { if (!open) setNewFolderParent(undefined) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('sidebar.newFolder')}</DialogTitle>
          </DialogHeader>
          <Input
            placeholder={t('sidebar.folderName')}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createFolder() } }}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={createFolder}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
