import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { chatTimeGroup } from '@/lib/format'
import { resolveChatExpiryMenuAction } from '@/lib/chat-expiration'
import { chatHasStreamingResponse } from '@/lib/response-tracking'
import type { Chat, Folder } from '@/lib/types'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { apiRequest } from '@/lib/api'
import { toggleSidebarPin, type SidebarPinKey } from '@/lib/sidebar-pins'

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'] as const

type DragKind = 'folder' | 'chat'
type ChatList = 'pinned' | 'loose' | `folder:${string}`

type DropHint =
  | { kind: 'row'; list: ChatList | 'folder'; id: string; edge: 'before' | 'after' }
  | { kind: 'folder-target'; folderId: string }
  | { kind: 'loose-target' }

function bySortOrder<T extends { sortOrder: number; updatedAt?: number; pinned?: boolean }>(a: T, b: T) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.updatedAt !== undefined && b.updatedAt !== undefined && a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt
  }
  return Number(b.pinned ?? false) - Number(a.pinned ?? false)
}

function folderListId(folderId: string): ChatList {
  return `folder:${folderId}`
}

function parseFolderList(list: ChatList): string | null {
  return list.startsWith('folder:') ? list.slice('folder:'.length) : null
}

function useSidebarDrag() {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<DragKind | null>(null)
  const [dragList, setDragList] = useState<ChatList | null>(null)
  const [drop, setDrop] = useState<DropHint | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const dragKindRef = useRef<DragKind | null>(null)
  const dragListRef = useRef<ChatList | null>(null)
  const didDragRef = useRef(false)

  const clearDrag = () => {
    dragIdRef.current = null
    dragKindRef.current = null
    dragListRef.current = null
    setDragId(null)
    setDragKind(null)
    setDragList(null)
    setDrop(null)
  }

  const startDrag = (kind: DragKind, id: string, e: DragEvent, list?: ChatList) => {
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

  const onFolderRowDragOver = (id: string, e: DragEvent<HTMLElement>) => {
    if (dragKindRef.current === 'chat' && dragIdRef.current) {
      acceptMove(e)
      if (drop?.kind !== 'folder-target' || drop.folderId !== id) {
        setDrop({ kind: 'folder-target', folderId: id })
      }
      return
    }
    if (dragKindRef.current !== 'folder' || !dragIdRef.current || dragIdRef.current === id) return
    acceptMove(e)
    const edge = edgeFor(e)
    if (drop?.kind !== 'row' || drop.list !== 'folder' || drop.id !== id || drop.edge !== edge) {
      setDrop({ kind: 'row', list: 'folder', id, edge })
    }
  }

  const onChatRowDragOver = (list: ChatList, id: string, e: DragEvent<HTMLElement>) => {
    if (dragKindRef.current !== 'chat' || !dragIdRef.current || dragIdRef.current === id) return
    // Pinned list only reorders within itself
    if (list === 'pinned' && dragListRef.current !== 'pinned') return
    if (dragListRef.current === 'pinned' && list !== 'pinned') return
    acceptMove(e)
    if (list === 'loose') {
      if (drop?.kind !== 'loose-target') setDrop({ kind: 'loose-target' })
      return
    }
    const edge = edgeFor(e)
    if (drop?.kind !== 'row' || drop.list !== list || drop.id !== id || drop.edge !== edge) {
      setDrop({ kind: 'row', list, id, edge })
    }
  }

  const onFolderBodyDragOver = (folderId: string, e: DragEvent<HTMLElement>) => {
    if (dragKindRef.current !== 'chat' || !dragIdRef.current) return
    acceptMove(e)
    if (drop?.kind !== 'folder-target' || drop.folderId !== folderId) {
      setDrop({ kind: 'folder-target', folderId })
    }
  }

  const onLooseZoneDragOver = (e: DragEvent<HTMLElement>) => {
    if (dragKindRef.current !== 'chat' || !dragIdRef.current) return
    if (dragListRef.current === 'pinned') return
    acceptMove(e)
    if (drop?.kind !== 'loose-target') setDrop({ kind: 'loose-target' })
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
    onFolderRowDragOver,
    onChatRowDragOver,
    onFolderBodyDragOver,
    onLooseZoneDragOver,
    setDrop,
  }
}

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

function ChatMenu({ chat, onRename }: { chat: Chat; onRename: () => void }) {
  const togglePin = useChat((state) => state.togglePin)
  const setChatAutoExpiration = useChat((state) => state.setChatAutoExpiration)
  const shareChat = useChat((state) => state.shareChat)
  const deleteChat = useChat((state) => state.deleteChat)
  const moveToFolder = useChat((state) => state.moveToFolder)
  const folders = useChat((state) => state.folders)
  const trashRetention = useSettings((state) => state.trashRetention)
  const automaticChatExpiration = useSettings((state) => state.automaticChatExpiration)
  const expirationMenuAction = resolveChatExpiryMenuAction(chat.expiresAt, automaticChatExpiration)
  return (
    <DropdownMenuContent side="right" align="start" className="w-48">
      <DropdownMenuItem onClick={() => togglePin(chat.id)}>
        {chat.pinned ? <PinOff /> : <Pin />}
        {chat.pinned ? 'Unpin' : 'Pin'}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onRename}>
        <Pencil />
        Rename
      </DropdownMenuItem>
      {expirationMenuAction && (
        <DropdownMenuItem onClick={() => setChatAutoExpiration(chat.id, expirationMenuAction.kind === 'enable')}>
          <Hourglass className={cn(expirationMenuAction.kind === 'disable' && 'text-teal-500 dark:text-teal-400')} />
          {expirationMenuAction.kind === 'disable' && chat.expiresAt !== null
            ? <span>Disable expiry in <ExpiryCountdown expiresAt={chat.expiresAt} /></span>
            : expirationMenuAction.kind === 'enable' ? expirationMenuAction.label : null}
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput />
          Move to folder
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-44">
          <DropdownMenuItem onClick={() => moveToFolder(chat.id, null)}>
            No folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {folders.map((f) => (
            <DropdownMenuItem key={f.id} onClick={() => moveToFolder(chat.id, f.id)}>
              <FolderIcon />
              {f.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        onClick={() => void shareChat(chat.id).then((url) => navigator.clipboard?.writeText(url))}
      >
        <Share2 />
        Copy share link
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
        <Trash2 />
        {trashRetention === 'instant' ? 'Delete' : 'Trash'}
      </DropdownMenuItem>
    </DropdownMenuContent>
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

function ChatRow({
  chat,
  active,
  shiftHeld,
  onNavigate,
  draggable: canDrag = false,
  droppable: canDrop = false,
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
  dragging?: boolean
  showLineBefore?: boolean
  showLineAfter?: boolean
  onDragStart?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent) => void
  onDragEnd?: () => void
  didDragRef?: { current: boolean }
}) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(chat.title)
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
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrop || canDrag ? onDragOver : undefined}
      onDrop={canDrop || canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
        canDrag && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
      onClick={() => {
        if (didDragRef?.current) {
          didDragRef.current = false
          return
        }
        navigate(`/c/${chat.id}`)
        onNavigate?.()
      }}
    >
      <DropLines active={canDrag || canDrop} before={showLineBefore} after={showLineAfter} />
      <span className="flex-1 truncate">{chat.title}</span>
      {shiftHeld ? (
        <button
          className={cn(actionClassName, 'invisible hover:text-destructive group-hover:visible')}
          onClick={(e) => {
            e.stopPropagation()
            deleteChat(chat.id)
          }}
          aria-label={`${trashRetention === 'instant' ? 'Delete' : 'Trash'} chat`}
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                actionClassName,
                'group/chat-action',
                generating || chat.expiresAt !== null ? 'visible' : 'invisible group-hover:visible',
                'data-[state=open]:visible',
              )}
              onClick={(e) => e.stopPropagation()}
              aria-label={generating ? 'Generation active; chat options' : 'Chat options'}
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
          <ChatMenu chat={chat} onRename={() => setRenameOpen(true)} />
        </DropdownMenu>
      )}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <DialogFooter>
            <Button
              onClick={() => {
                renameChat(chat.id, title.trim() || chat.title)
                setRenameOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FolderGroup({
  folder,
  chats,
  chatId,
  shiftHeld,
  onNavigate,
  canReorderFolder,
  folderDragging,
  showFolderLineBefore,
  showFolderLineAfter,
  chatDropHighlight,
  onFolderDragStart,
  onFolderDragOver,
  onFolderDrop,
  onFolderDragEnd,
  folderDidDragRef,
  drag,
  onChatDrop,
  onFolderChatTarget,
}: {
  folder: Folder
  chats: Chat[]
  chatId?: string
  shiftHeld: boolean
  onNavigate: () => void
  canReorderFolder: boolean
  folderDragging: boolean
  showFolderLineBefore: boolean
  showFolderLineAfter: boolean
  chatDropHighlight: boolean
  onFolderDragStart: (e: DragEvent) => void
  onFolderDragOver: (e: DragEvent<HTMLElement>) => void
  onFolderDrop: (e: DragEvent) => void
  onFolderDragEnd: () => void
  folderDidDragRef: { current: boolean }
  drag: ReturnType<typeof useSidebarDrag>
  onChatDrop: (e: DragEvent, list: ChatList, targetId: string) => void
  onFolderChatTarget: (e: DragEvent, folderId: string) => void
}) {
  const toggleFolder = useChat((state) => state.toggleFolder)
  const renameFolder = useChat((state) => state.renameFolder)
  const toggleFolderPin = useChat((state) => state.toggleFolderPin)
  const deleteFolder = useChat((state) => state.deleteFolder)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(folder.name)
  const list = folderListId(folder.id)

  useEffect(() => setName(folder.name), [folder.name])

  return (
    <Collapsible open={folder.expanded} onOpenChange={() => {
      if (folderDidDragRef.current) {
        folderDidDragRef.current = false
        return
      }
      toggleFolder(folder.id)
    }}>
      <div
        draggable={canReorderFolder}
        onDragStart={canReorderFolder ? onFolderDragStart : undefined}
        onDragOver={onFolderDragOver}
        onDrop={onFolderDrop}
        onDragEnd={canReorderFolder ? onFolderDragEnd : undefined}
        className={cn(
          'group relative flex items-center rounded-lg text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70',
          canReorderFolder && 'cursor-grab active:cursor-grabbing',
          folderDragging && 'opacity-40',
          chatDropHighlight && 'bg-sidebar-accent ring-1 ring-foreground/20',
        )}
      >
        <DropLines active={!chatDropHighlight} before={showFolderLineBefore} after={showFolderLineAfter} />
        <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1.5">
          <ChevronRight
            className={cn('size-3.5 text-muted-foreground transition-transform', folder.expanded && 'rotate-90')}
          />
          <FolderIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-left">{folder.name}</span>
        </CollapsibleTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible data-[state=open]:visible"
              aria-label="Folder options"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-48">
            <DropdownMenuItem onClick={() => toggleFolderPin(folder.id)}>
              {folder.pinned ? <PinOff /> : <Pin />}
              {folder.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => deleteFolder(folder.id)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="mr-2 min-w-3 text-right text-xs text-muted-foreground">{chats.length}</span>
      </div>
      <CollapsibleContent
        className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2"
        onDragOver={(e) => drag.onFolderBodyDragOver(folder.id, e)}
        onDrop={(e) => onFolderChatTarget(e, folder.id)}
      >
        {chats.length === 0 && (
          <div
            className={cn(
              'rounded-md px-2 py-1 text-xs text-muted-foreground',
              chatDropHighlight && 'bg-sidebar-accent/80 text-foreground',
            )}
          >
            {chatDropHighlight ? 'Drop to add' : 'Empty'}
          </div>
        )}
        {chats.map((chat) => {
          const isDragging = drag.dragKind === 'chat' && drag.dragId === chat.id
          const rowDrop = drag.drop?.kind === 'row' && drag.drop.list === list && drag.drop.id === chat.id
          const showLineBefore = Boolean(rowDrop && drag.drop?.kind === 'row' && drag.drop.edge === 'before' && !isDragging)
          const showLineAfter = Boolean(rowDrop && drag.drop?.kind === 'row' && drag.drop.edge === 'after' && !isDragging)
          return (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === chatId}
              shiftHeld={shiftHeld}
              onNavigate={onNavigate}
              draggable
              droppable
              dragging={isDragging}
              showLineBefore={showLineBefore}
              showLineAfter={showLineAfter}
              didDragRef={drag.didDragRef}
              onDragStart={(e) => drag.startDrag('chat', chat.id, e, list)}
              onDragOver={(e) => drag.onChatRowDragOver(list, chat.id, e)}
              onDrop={(e) => onChatDrop(e, list, chat.id)}
              onDragEnd={drag.clearDrag}
            />
          )
        })}
      </CollapsibleContent>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <DialogFooter>
            <Button
              onClick={() => {
                renameFolder(folder.id, name.trim() || folder.name)
                setRenameOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
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
  const navigate = useNavigate()
  const { chatId } = useParams()
  const chatListRevision = useChat((state) => state.chats.map((chat) => (
    `${chat.id}:${chat.title}:${chat.updatedAt}:${chat.pinned}:${chat.folderId ?? ''}:${chat.modelId}:${chat.sortOrder}:${chat.temporary}`
  )).join('|'))
  void chatListRevision
  const folderListRevision = useChat((state) => state.folders.map((folder) => (
    `${folder.id}:${folder.name}:${folder.pinned}:${folder.expanded}:${folder.sortOrder}`
  )).join('|'))
  void folderListRevision
  const chats = useChat.getState().chats.filter((chat) => !chat.temporary)
  const folders = useChat.getState().folders
  const addFolder = useChat((s) => s.addFolder)
  const reorderFolders = useChat((s) => s.reorderFolders)
  const reorderPinnedChats = useChat((s) => s.reorderPinnedChats)
  const reorderFolderChats = useChat((s) => s.reorderFolderChats)
  const moveToFolder = useChat((s) => s.moveToFolder)
  const toggleFolder = useChat((s) => s.toggleFolder)
  const user = useAuth((s) => s.user)
  const pendingFriendsQuery = useQuery({
    queryKey: ['friends-pending-count', user?.id],
    queryFn: () => apiRequest<{ count: number }>('/api/friends/pending-count'),
    enabled: Boolean(user?.id && user.role !== 'pending'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const apiKeysEnabled = useAuth((s) => s.apiKeysEnabled)
  const sidebarPins = useSettings((s) => s.sidebarPins)
  const setSetting = useSettings((s) => s.set)
  const logout = useAuth((s) => s.logout)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const shiftHeld = useShiftHeld()
  const drag = useSidebarDrag()

  const ensureFolderExpanded = (folderId: string) => {
    const target = useChat.getState().folders.find((folder) => folder.id === folderId)
    if (target && !target.expanded) toggleFolder(folderId)
  }

  const handleChatDropOnRow = (e: DragEvent, list: ChatList, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag.dragKindRef.current !== 'chat') {
      drag.clearDrag()
      return
    }
    const from = drag.dragIdRef.current ?? e.dataTransfer.getData('text/plain')
    if (!from || from === targetId) {
      drag.clearDrag()
      return
    }

    const edge =
      drag.drop?.kind === 'row' && drag.drop.list === list && drag.drop.id === targetId
        ? drag.drop.edge
        : 'before'

    if (list === 'pinned') {
      if (drag.dragListRef.current === 'pinned') reorderPinnedChats(from, targetId, edge)
      drag.clearDrag()
      return
    }

    if (list === 'loose') {
      const sourceChat = useChat.getState().chats.find((chat) => chat.id === from)
      if (sourceChat?.folderId) moveToFolder(from, null)
      drag.clearDrag()
      return
    }

    const folderId = parseFolderList(list)
    if (!folderId) {
      drag.clearDrag()
      return
    }

    const sourceList = drag.dragListRef.current
    if (sourceList === list) {
      reorderFolderChats(folderId, from, targetId, edge)
    } else {
      moveToFolder(from, folderId, { targetId, edge })
      ensureFolderExpanded(folderId)
    }
    drag.clearDrag()
  }

  const handleDropIntoFolder = (e: DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag.dragKindRef.current !== 'chat') {
      drag.clearDrag()
      return
    }
    const from = drag.dragIdRef.current ?? e.dataTransfer.getData('text/plain')
    if (!from) {
      drag.clearDrag()
      return
    }
    const sourceChat = useChat.getState().chats.find((chat) => chat.id === from)
    if (!sourceChat || sourceChat.folderId === folderId) {
      drag.clearDrag()
      return
    }
    moveToFolder(from, folderId)
    ensureFolderExpanded(folderId)
    drag.clearDrag()
  }

  const handleDropToLoose = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag.dragKindRef.current !== 'chat') {
      drag.clearDrag()
      return
    }
    const from = drag.dragIdRef.current ?? e.dataTransfer.getData('text/plain')
    if (!from) {
      drag.clearDrag()
      return
    }
    const sourceChat = useChat.getState().chats.find((chat) => chat.id === from)
    if (sourceChat?.folderId) moveToFolder(from, null)
    drag.clearDrag()
  }

  const handleFolderDrop = (folderId: string, e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (drag.dragKindRef.current === 'chat') {
      handleDropIntoFolder(e, folderId)
      return
    }
    if (drag.dragKindRef.current !== 'folder') {
      drag.clearDrag()
      return
    }
    const from = drag.dragIdRef.current ?? e.dataTransfer.getData('text/plain')
    const edge =
      drag.drop?.kind === 'row' && drag.drop.list === 'folder' && drag.drop.id === folderId
        ? drag.drop.edge
        : 'before'
    if (from && from !== folderId) reorderFolders(from, folderId, edge)
    drag.clearDrag()
  }

  const go = (path: string) => {
    navigate(path)
    onNavigate()
  }

  const startNewChat = () => {
    useChat.getState().abandonTemporaryChat()
    navigate('/', {
      state: { resetDefaultModel: `${Date.now()}-${Math.random()}` },
    })
    onNavigate()
  }

  useEffect(() => {
    setActiveTooltip(null)
  }, [collapsed])

  const orderedFolders = useMemo(() => [...folders].sort(bySortOrder), [folders])
  const pinned = useMemo(() => chats.filter((c) => c.pinned).sort(bySortOrder), [chats])
  const unpinned = useMemo(
    () => [...chats].filter((c) => !c.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
    [chats],
  )
  const inFolders = new Map<string, Chat[]>()
  for (const f of folders) inFolders.set(f.id, [])
  const loose: Chat[] = []
  for (const c of unpinned) {
    if (c.folderId && inFolders.has(c.folderId)) inFolders.get(c.folderId)!.push(c)
    else loose.push(c)
  }
  for (const [folderId, items] of inFolders) {
    inFolders.set(folderId, [...items].sort(bySortOrder))
  }
  const groups = new Map<string, Chat[]>()
  for (const c of loose) {
    const g = chatTimeGroup(c.updatedAt)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(c)
  }

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

  const iconBtn = (label: string, onClick: () => void, icon: React.ReactNode, badge?: number) => (
    <Tooltip
      key={label}
      open={collapsed && activeTooltip === label}
      onOpenChange={(open) => {
        if (collapsed) setActiveTooltip(open ? label : null)
      }}
    >
      <TooltipTrigger asChild>
        <button className={navBtn} onClick={onClick} aria-label={label}>
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
    path: string,
    icon: React.ReactNode,
    badge?: number,
  ) => {
    const pinned = sidebarPins[key]
    const action = pinned ? 'Unpin' : 'Pin'
    return (
      <div key={key} className="group/account-nav relative">
        <DropdownMenuItem className="w-full pr-9" onClick={() => go(path)}>
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {Boolean(badge) && <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">
            {badge! > 99 ? '99+' : badge}
          </span>}
        </DropdownMenuItem>
        <button
          type="button"
          aria-label={`${action} ${label} ${pinned ? 'from' : 'to'} sidebar`}
          title={`${action} ${label} ${pinned ? 'from' : 'to'} sidebar`}
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
      aria-label="Sidebar"
      aria-hidden={mobile && !mobileOpen}
      inert={mobile && !mobileOpen}
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar motion-reduce:transition-none',
        mobile
          ? cn(
              'fixed inset-y-0 left-0 z-40 w-[min(82vw,320px)] shadow-2xl',
              transitions && 'transition-transform duration-200 ease-out'
            )
          : cn(
              'relative will-change-[width]',
              transitions &&
                'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]'
            ),
        mobile && !mobileOpen && '-translate-x-full',
        !mobile && (collapsed ? 'w-[52px]' : 'w-[264px]')
      )}
    >
      {/* header */}
      <div className="flex items-center gap-1 p-2">
        <Tooltip
          open={collapsed && activeTooltip === 'Open sidebar'}
          onOpenChange={(open) => {
            if (collapsed) setActiveTooltip(open ? 'Open sidebar' : null)
          }}
        >
          <TooltipTrigger asChild>
            <button
              className="group/logo flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-sidebar-accent"
              onClick={collapsed ? onToggle : () => go('/')}
              aria-label={collapsed ? 'Open sidebar' : 'Home'}
            >
              <img
                src="/pulpo-smiley.png"
                alt="Pulpo"
                className={cn('size-6', collapsed && 'group-hover/logo:hidden')}
              />
              {collapsed && <PanelLeftOpen className="hidden size-4 group-hover/logo:block" />}
            </button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Open sidebar</TooltipContent>}
        </Tooltip>
        <span
          className={cn(
            'min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold text-sidebar-foreground transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
            sidebarTextTransition
          )}
        >
          Pulpo
        </span>
        {!collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                onClick={onToggle}
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* The complete menu shares one scroll position; the header and account stay anchored. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* primary nav */}
        <div className="space-y-0.5 px-2">
          {iconBtn('New chat', startNewChat, <SquarePen className="size-4" />)}
          {iconBtn('Search chats', onOpenSearch, <Search className="size-4" />)}
          {sidebarPins.usage && iconBtn('Usage', () => go('/usage'), <BarChart3 className="size-4" />)}
          {sidebarPins.friends && iconBtn('Friends', () => go('/friends'), <UsersRound className="size-4" />, pendingFriendsQuery.data?.count)}
          {apiKeysEnabled && sidebarPins.apiKeys && iconBtn('API keys', () => go('/api-keys'), <KeyRound className="size-4" />)}
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
            {pinned.length > 0 && (
              <div className="mb-2">
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Pinned
                </div>
                <div className="space-y-0.5">
                  {pinned.map((c) => {
                    const canReorder = pinned.length > 1
                    const isDragging = drag.dragKind === 'chat' && drag.dragList === 'pinned' && drag.dragId === c.id
                    const rowDrop = drag.drop?.kind === 'row' && drag.drop.list === 'pinned' && drag.drop.id === c.id
                    const showLineBefore = Boolean(rowDrop && drag.drop?.kind === 'row' && drag.drop.edge === 'before' && !isDragging)
                    const showLineAfter = Boolean(rowDrop && drag.drop?.kind === 'row' && drag.drop.edge === 'after' && !isDragging)
                    return (
                      <ChatRow
                        key={c.id}
                        chat={c}
                        active={c.id === chatId}
                        shiftHeld={shiftHeld}
                        onNavigate={onNavigate}
                        draggable={canReorder}
                        droppable={canReorder}
                        dragging={isDragging}
                        showLineBefore={showLineBefore}
                        showLineAfter={showLineAfter}
                        didDragRef={drag.didDragRef}
                        onDragStart={(e) => drag.startDrag('chat', c.id, e, 'pinned')}
                        onDragOver={(e) => drag.onChatRowDragOver('pinned', c.id, e)}
                        onDrop={(e) => handleChatDropOnRow(e, 'pinned', c.id)}
                        onDragEnd={drag.clearDrag}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {orderedFolders.map((f) => {
              const items = inFolders.get(f.id) ?? []
              const canReorderFolder = orderedFolders.length > 1
              const isDragging = drag.dragKind === 'folder' && drag.dragId === f.id
              const rowDrop = drag.drop?.kind === 'row' && drag.drop.list === 'folder' && drag.drop.id === f.id
              const showFolderLineBefore = Boolean(rowDrop && drag.drop?.kind === 'row' && drag.drop.edge === 'before' && !isDragging)
              const showFolderLineAfter = Boolean(rowDrop && drag.drop?.kind === 'row' && drag.drop.edge === 'after' && !isDragging)
              const chatDropHighlight =
                drag.dragKind === 'chat'
                && drag.drop?.kind === 'folder-target'
                && drag.drop.folderId === f.id
              return (
                <FolderGroup
                  key={f.id}
                  folder={f}
                  chats={items}
                  chatId={chatId}
                  shiftHeld={shiftHeld}
                  onNavigate={onNavigate}
                  canReorderFolder={canReorderFolder}
                  folderDragging={isDragging}
                  showFolderLineBefore={showFolderLineBefore}
                  showFolderLineAfter={showFolderLineAfter}
                  chatDropHighlight={chatDropHighlight}
                  onFolderDragStart={(e) => drag.startDrag('folder', f.id, e)}
                  onFolderDragOver={(e) => drag.onFolderRowDragOver(f.id, e)}
                  onFolderDrop={(e) => handleFolderDrop(f.id, e)}
                  onFolderDragEnd={drag.clearDrag}
                  folderDidDragRef={drag.didDragRef}
                  drag={drag}
                  onChatDrop={handleChatDropOnRow}
                  onFolderChatTarget={handleDropIntoFolder}
                />
              )
            })}

            <button
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
              onClick={() => setNewFolderOpen(true)}
            >
              <Plus className="size-3.5" /> New folder
            </button>

            <div
              className={cn(
                'rounded-lg',
                drag.drop?.kind === 'loose-target' && drag.dragKind === 'chat' && 'bg-sidebar-accent/40 ring-1 ring-foreground/10',
              )}
              onDragOver={drag.onLooseZoneDragOver}
              onDrop={handleDropToLoose}
            >
              {GROUP_ORDER.map((g) => {
                const items = groups.get(g)
                if (!items?.length) return null
                return (
                  <div key={g} className="mt-3">
                    <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {g}
                    </div>
                    <div className="space-y-0.5">
                      {items.map((c) => {
                        const isDragging = drag.dragKind === 'chat' && drag.dragId === c.id
                        return (
                          <ChatRow
                            key={c.id}
                            chat={c}
                            active={c.id === chatId}
                            shiftHeld={shiftHeld}
                            onNavigate={onNavigate}
                            draggable
                            droppable
                            dragging={isDragging}
                            didDragRef={drag.didDragRef}
                            onDragStart={(e) => drag.startDrag('chat', c.id, e, 'loose')}
                            onDragOver={(e) => drag.onChatRowDragOver('loose', c.id, e)}
                            onDrop={(e) => handleChatDropOnRow(e, 'loose', c.id)}
                            onDragEnd={drag.clearDrag}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {loose.length === 0 && drag.dragKind === 'chat' && drag.dragList !== 'loose' && drag.dragList !== 'pinned' && (
                <div className="mt-3 px-2 py-2 text-xs text-muted-foreground">
                  Drop here to remove from folder
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* user footer */}
      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg text-left hover:bg-sidebar-accent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <ProfileAvatar name={user?.name ?? 'Pulpo user'} avatarUrl={user?.avatarUrl} className="size-7" fallbackClassName="text-[11px]" />
              </span>
              <div
                className={cn(
                  'min-w-0 flex-1 whitespace-nowrap pr-2 transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
                  sidebarTextTransition
                )}
              >
                <div className="truncate text-sm font-medium">{user?.name ?? 'Signed out'}</div>
                <div className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            {accountNavItem('usage', 'Usage', '/usage', <BarChart3 />)}
            {accountNavItem('friends', 'Friends', '/friends', <UsersRound />, pendingFriendsQuery.data?.count)}
            {apiKeysEnabled && accountNavItem('apiKeys', 'API keys', '/api-keys', <KeyRound />)}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings />
              Settings
            </DropdownMenuItem>
            {user?.role === 'admin' && (
              <DropdownMenuItem onClick={() => go('/admin')}>
                <ShieldCheck />
                Admin panel
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                logout()
                navigate('/login')
                onNavigate()
              }}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Folder name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              onClick={() => {
                if (folderName.trim()) addFolder(folderName.trim())
                setFolderName('')
                setNewFolderOpen(false)
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
