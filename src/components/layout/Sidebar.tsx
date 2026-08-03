import { useEffect, useMemo, useState } from 'react'
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
}: {
  chat: Chat
  active: boolean
  shiftHeld: boolean
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const renameChat = useChat((state) => state.renameChat)
  const deleteChat = useChat((state) => state.deleteChat)

  const actionClassName =
    'invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible'

  const row = (
    <div
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60'
      )}
      onClick={() => {
        navigate(`/c/${chat.id}`)
        onNavigate?.()
      }}
    >
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

  return row
}

function FolderGroup({
  folder,
  chats,
  chatId,
  shiftHeld,
  onNavigate,
}: {
  folder: Folder
  chats: Chat[]
  chatId?: string
  shiftHeld: boolean
  onNavigate: () => void
}) {
  const toggleFolder = useChat((state) => state.toggleFolder)
  const renameFolder = useChat((state) => state.renameFolder)
  const toggleFolderPin = useChat((state) => state.toggleFolderPin)
  const deleteFolder = useChat((state) => state.deleteFolder)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(folder.name)

  useEffect(() => setName(folder.name), [folder.name])

  return (
    <Collapsible open={folder.expanded} onOpenChange={() => toggleFolder(folder.id)}>
      <div className="group flex items-center rounded-lg text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70">
        <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1.5">
          <ChevronRight
            className={cn('size-3.5 text-muted-foreground transition-transform', folder.expanded && 'rotate-90')}
          />
          <FolderIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-left">{folder.name}</span>
          <span className="text-xs text-muted-foreground">{chats.length}</span>
        </CollapsibleTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="invisible mr-1 rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible data-[state=open]:visible"
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
      </div>
      <CollapsibleContent className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
        {chats.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">Empty</div>
        )}
        {chats.map((chat) => (
          <ChatRow key={chat.id} chat={chat} active={chat.id === chatId} shiftHeld={shiftHeld} onNavigate={onNavigate} />
        ))}
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
    `${chat.id}:${chat.title}:${chat.updatedAt}:${chat.pinned}:${chat.folderId ?? ''}:${chat.modelId}`
  )).join('|'))
  void chatListRevision
  const chats = useChat.getState().chats
  const folders = useChat((s) => s.folders)
  const addFolder = useChat((s) => s.addFolder)
  const user = useAuth((s) => s.user)
  const apiKeysEnabled = useAuth((s) => s.apiKeysEnabled)
  const logout = useAuth((s) => s.logout)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const shiftHeld = useShiftHeld()

  const go = (path: string) => {
    navigate(path)
    onNavigate()
  }

  useEffect(() => {
    setActiveTooltip(null)
  }, [collapsed])

  const visible = useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt), [chats])
  const orderedFolders = useMemo(
    () => [...folders].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [folders],
  )
  const pinned = visible.filter((c) => c.pinned)
  const unpinned = visible.filter((c) => !c.pinned)
  const inFolders = new Map<string, Chat[]>()
  for (const f of folders) inFolders.set(f.id, [])
  const loose: Chat[] = []
  for (const c of unpinned) {
    if (c.folderId && inFolders.has(c.folderId)) inFolders.get(c.folderId)!.push(c)
    else loose.push(c)
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
                  {pinned.map((c) => (
                    <ChatRow key={c.id} chat={c} active={c.id === chatId} shiftHeld={shiftHeld} onNavigate={onNavigate} />
                  ))}
                </div>
              </div>
            )}

            {orderedFolders.map((f) => {
              const items = inFolders.get(f.id) ?? []
              return (
                <FolderGroup
                  key={f.id}
                  folder={f}
                  chats={items}
                  chatId={chatId}
                  shiftHeld={shiftHeld}
                  onNavigate={onNavigate}
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
