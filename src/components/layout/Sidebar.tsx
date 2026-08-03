import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  BarChart3,
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
  KeyRound,
  LogOut,
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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { useAuth } from '@/stores/auth'
import { chatTimeGroup } from '@/lib/format'
import type { Chat, Folder } from '@/lib/types'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'] as const

type DragScope = 'folder' | 'pinned' | `folder-chat:${string}`

function bySortOrder<T extends { sortOrder: number; updatedAt?: number; pinned?: boolean }>(a: T, b: T) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.updatedAt !== undefined && b.updatedAt !== undefined && a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt
  }
  return Number(b.pinned ?? false) - Number(a.pinned ?? false)
}

function useListReorder() {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragScope, setDragScope] = useState<DragScope | null>(null)
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const dragScopeRef = useRef<DragScope | null>(null)
  const didDragRef = useRef(false)

  const clearDrag = () => {
    dragIdRef.current = null
    dragScopeRef.current = null
    setDragId(null)
    setDragScope(null)
    setDrop(null)
  }

  const startDrag = (scope: DragScope, id: string, e: DragEvent) => {
    didDragRef.current = false
    dragIdRef.current = id
    dragScopeRef.current = scope
    setDragId(id)
    setDragScope(scope)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onItemDragOver = (scope: DragScope, id: string, e: DragEvent<HTMLElement>) => {
    if (dragScopeRef.current !== scope || !dragIdRef.current || dragIdRef.current === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    didDragRef.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    if (drop?.id !== id || drop.edge !== edge) setDrop({ id, edge })
  }

  const dropOn = (scope: DragScope, id: string, e: DragEvent, reorder: (from: string, to: string, edge: 'before' | 'after') => void) => {
    e.preventDefault()
    if (dragScopeRef.current !== scope) return
    const from = dragIdRef.current ?? e.dataTransfer.getData('text/plain')
    const edge = drop?.id === id ? drop.edge : 'before'
    if (from) reorder(from, id, edge)
    clearDrag()
  }

  return {
    dragId,
    dragScope,
    drop,
    didDragRef,
    clearDrag,
    startDrag,
    onItemDragOver,
    dropOn,
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
  const shareChat = useChat((state) => state.shareChat)
  const deleteChat = useChat((state) => state.deleteChat)
  const moveToFolder = useChat((state) => state.moveToFolder)
  const folders = useChat((state) => state.folders)
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
        Delete
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

  const actionClassName =
    'invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible'

  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
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
      <DropLines active={canDrag} before={showLineBefore} after={showLineAfter} />
      <span className="flex-1 truncate">{chat.title}</span>
      {shiftHeld ? (
        <button
          className={cn(actionClassName, 'hover:text-destructive')}
          onClick={(e) => {
            e.stopPropagation()
            deleteChat(chat.id)
          }}
          aria-label="Delete chat"
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(actionClassName, 'data-[state=open]:visible')}
              onClick={(e) => e.stopPropagation()}
              aria-label="Chat options"
            >
              <MoreHorizontal className="size-4" />
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
  onFolderDragStart,
  onFolderDragOver,
  onFolderDrop,
  onFolderDragEnd,
  folderDidDragRef,
  canReorderChats,
  chatDrag,
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
  onFolderDragStart: (e: DragEvent) => void
  onFolderDragOver: (e: DragEvent<HTMLElement>) => void
  onFolderDrop: (e: DragEvent) => void
  onFolderDragEnd: () => void
  folderDidDragRef: { current: boolean }
  canReorderChats: boolean
  chatDrag: {
    dragId: string | null
    dragScope: DragScope | null
    drop: { id: string; edge: 'before' | 'after' } | null
    didDragRef: { current: boolean }
    startDrag: (scope: DragScope, id: string, e: DragEvent) => void
    onItemDragOver: (scope: DragScope, id: string, e: DragEvent<HTMLElement>) => void
    dropOn: (scope: DragScope, id: string, e: DragEvent, reorder: (from: string, to: string, edge: 'before' | 'after') => void) => void
    clearDrag: () => void
  }
}) {
  const toggleFolder = useChat((state) => state.toggleFolder)
  const renameFolder = useChat((state) => state.renameFolder)
  const toggleFolderPin = useChat((state) => state.toggleFolderPin)
  const deleteFolder = useChat((state) => state.deleteFolder)
  const reorderFolderChats = useChat((state) => state.reorderFolderChats)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(folder.name)
  const chatScope = `folder-chat:${folder.id}` as const

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
        onDragOver={canReorderFolder ? onFolderDragOver : undefined}
        onDrop={canReorderFolder ? onFolderDrop : undefined}
        onDragEnd={canReorderFolder ? onFolderDragEnd : undefined}
        className={cn(
          'group relative flex items-center rounded-lg text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70',
          canReorderFolder && 'cursor-grab active:cursor-grabbing',
          folderDragging && 'opacity-40',
        )}
      >
        <DropLines active={canReorderFolder} before={showFolderLineBefore} after={showFolderLineAfter} />
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
      <CollapsibleContent className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
        {chats.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">Empty</div>
        )}
        {chats.map((chat) => {
          const isDragging = chatDrag.dragScope === chatScope && chatDrag.dragId === chat.id
          const showLineBefore =
            chatDrag.dragScope === chatScope && chatDrag.drop?.id === chat.id && chatDrag.drop.edge === 'before' && !isDragging
          const showLineAfter =
            chatDrag.dragScope === chatScope && chatDrag.drop?.id === chat.id && chatDrag.drop.edge === 'after' && !isDragging
          return (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === chatId}
              shiftHeld={shiftHeld}
              onNavigate={onNavigate}
              draggable={canReorderChats}
              dragging={isDragging}
              showLineBefore={showLineBefore}
              showLineAfter={showLineAfter}
              didDragRef={chatDrag.didDragRef}
              onDragStart={(e) => chatDrag.startDrag(chatScope, chat.id, e)}
              onDragOver={(e) => chatDrag.onItemDragOver(chatScope, chat.id, e)}
              onDrop={(e) => chatDrag.dropOn(chatScope, chat.id, e, (from, to, edge) => reorderFolderChats(folder.id, from, to, edge))}
              onDragEnd={chatDrag.clearDrag}
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
    `${chat.id}:${chat.title}:${chat.updatedAt}:${chat.pinned}:${chat.folderId ?? ''}:${chat.modelId}:${chat.sortOrder}`
  )).join('|'))
  void chatListRevision
  const folderListRevision = useChat((state) => state.folders.map((folder) => (
    `${folder.id}:${folder.name}:${folder.pinned}:${folder.expanded}:${folder.sortOrder}`
  )).join('|'))
  void folderListRevision
  const chats = useChat.getState().chats
  const folders = useChat.getState().folders
  const addFolder = useChat((s) => s.addFolder)
  const reorderFolders = useChat((s) => s.reorderFolders)
  const reorderPinnedChats = useChat((s) => s.reorderPinnedChats)
  const user = useAuth((s) => s.user)
  const apiKeysEnabled = useAuth((s) => s.apiKeysEnabled)
  const logout = useAuth((s) => s.logout)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const shiftHeld = useShiftHeld()
  const reorder = useListReorder()

  const go = (path: string) => {
    navigate(path)
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

  const iconBtn = (label: string, onClick: () => void, icon: React.ReactNode) => (
    <Tooltip
      key={label}
      open={collapsed && activeTooltip === label}
      onOpenChange={(open) => {
        if (collapsed) setActiveTooltip(open ? label : null)
      }}
    >
      <TooltipTrigger asChild>
        <button className={navBtn} onClick={onClick} aria-label={label}>
          <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
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
          {iconBtn('New chat', () => go('/'), <SquarePen className="size-4" />)}
          {iconBtn('Search chats', onOpenSearch, <Search className="size-4" />)}
          {iconBtn('Usage', () => go('/usage'), <BarChart3 className="size-4" />)}
          {apiKeysEnabled && iconBtn('API keys', () => go('/api-keys'), <KeyRound className="size-4" />)}
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
          <div className="px-2 pb-4 pt-4">
            {pinned.length > 0 && (
              <div className="mb-2">
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Pinned
                </div>
                <div className="space-y-0.5">
                  {pinned.map((c) => {
                    const canReorder = pinned.length > 1
                    const isDragging = reorder.dragScope === 'pinned' && reorder.dragId === c.id
                    const showLineBefore =
                      reorder.dragScope === 'pinned' && reorder.drop?.id === c.id && reorder.drop.edge === 'before' && !isDragging
                    const showLineAfter =
                      reorder.dragScope === 'pinned' && reorder.drop?.id === c.id && reorder.drop.edge === 'after' && !isDragging
                    return (
                      <ChatRow
                        key={c.id}
                        chat={c}
                        active={c.id === chatId}
                        shiftHeld={shiftHeld}
                        onNavigate={onNavigate}
                        draggable={canReorder}
                        dragging={isDragging}
                        showLineBefore={showLineBefore}
                        showLineAfter={showLineAfter}
                        didDragRef={reorder.didDragRef}
                        onDragStart={(e) => reorder.startDrag('pinned', c.id, e)}
                        onDragOver={(e) => reorder.onItemDragOver('pinned', c.id, e)}
                        onDrop={(e) => reorder.dropOn('pinned', c.id, e, reorderPinnedChats)}
                        onDragEnd={reorder.clearDrag}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {orderedFolders.map((f) => {
              const items = inFolders.get(f.id) ?? []
              const canReorderFolder = orderedFolders.length > 1
              const isDragging = reorder.dragScope === 'folder' && reorder.dragId === f.id
              const showFolderLineBefore =
                reorder.dragScope === 'folder' && reorder.drop?.id === f.id && reorder.drop.edge === 'before' && !isDragging
              const showFolderLineAfter =
                reorder.dragScope === 'folder' && reorder.drop?.id === f.id && reorder.drop.edge === 'after' && !isDragging
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
                  onFolderDragStart={(e) => reorder.startDrag('folder', f.id, e)}
                  onFolderDragOver={(e) => reorder.onItemDragOver('folder', f.id, e)}
                  onFolderDrop={(e) => reorder.dropOn('folder', f.id, e, reorderFolders)}
                  onFolderDragEnd={reorder.clearDrag}
                  folderDidDragRef={reorder.didDragRef}
                  canReorderChats={items.length > 1}
                  chatDrag={reorder}
                />
              )
            })}

            <button
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
              onClick={() => setNewFolderOpen(true)}
            >
              <Plus className="size-3.5" /> New folder
            </button>

            {GROUP_ORDER.map((g) => {
              const items = groups.get(g)
              if (!items?.length) return null
              return (
                <div key={g} className="mt-3">
                  <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {g}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((c) => (
                      <ChatRow key={c.id} chat={c} active={c.id === chatId} shiftHeld={shiftHeld} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              )
            })}
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
                <Avatar className="size-7">
                  <AvatarFallback className="bg-zinc-700 text-[11px] font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900">
                    {user?.initials ?? '?'}
                  </AvatarFallback>
                </Avatar>
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
