import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  BarChart3,
  ChevronRight,
  Copy,
  Folder as FolderIcon,
  FolderInput,
  KeyRound,
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
import { chatTimeGroup, timeAgo } from '@/lib/format'
import type { Chat } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  const { togglePin, toggleArchive, shareChat, deleteChat, moveToFolder, folders } = useChat()
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
        onClick={() => {
          shareChat(chat.id)
          navigator.clipboard?.writeText(`${location.origin}/share/${chat.id}`).catch(() => {})
        }}
      >
        <Share2 />
        Copy share link
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => toggleArchive(chat.id)}>
        <Archive />
        Archive
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
        <Trash2 />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function ChatRow({
  chat,
  active,
}: {
  chat: Chat
  active: boolean
}) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const { renameChat } = useChat()

  const row = (
    <div
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60'
      )}
      onClick={() => navigate(`/c/${chat.id}`)}
    >
      <span className="flex-1 truncate">{chat.title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="invisible rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover:visible data-[state=open]:visible"
            onClick={(e) => e.stopPropagation()}
            aria-label="Chat options"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <ChatMenu chat={chat} onRename={() => setRenameOpen(true)} />
      </DropdownMenu>
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

export function Sidebar({
  collapsed,
  onToggle,
  onOpenSearch,
  onOpenSettings,
}: {
  collapsed: boolean
  onToggle: () => void
  onOpenSearch: () => void
  onOpenSettings: () => void
}) {
  const navigate = useNavigate()
  const { chatId } = useParams()
  const chats = useChat((s) => s.chats)
  const folders = useChat((s) => s.folders)
  const toggleFolder = useChat((s) => s.toggleFolder)
  const addFolder = useChat((s) => s.addFolder)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)

  useEffect(() => {
    setActiveTooltip(null)
  }, [collapsed])

  const visible = useMemo(
    () => chats.filter((c) => !c.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [chats]
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

  const sidebarContentTransition = collapsed
    ? 'pointer-events-none opacity-0 duration-100'
    : 'opacity-100 delay-100 duration-150'
  const sidebarTextTransition = cn(
    sidebarContentTransition,
    collapsed ? '-translate-x-1' : 'translate-x-0'
  )

  const navBtn =
    'flex h-8 w-full cursor-pointer items-center overflow-hidden rounded-lg text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/70'

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
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width] motion-reduce:transition-none',
        collapsed ? 'w-[52px]' : 'w-[264px]'
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
              onClick={collapsed ? onToggle : () => navigate('/')}
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
      <ScrollArea className="min-h-0 flex-1">
        {/* primary nav */}
        <div className="space-y-0.5 px-2">
          {iconBtn('New chat', () => navigate('/'), <SquarePen className="size-4" />)}
          {iconBtn('Search chats', onOpenSearch, <Search className="size-4" />)}
          {iconBtn('Usage', () => navigate('/usage'), <BarChart3 className="size-4" />)}
          {iconBtn('API keys', () => navigate('/api-keys'), <KeyRound className="size-4" />)}
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
                    <ChatRow key={c.id} chat={c} active={c.id === chatId} />
                  ))}
                </div>
              </div>
            )}

            {folders.map((f) => {
              const items = inFolders.get(f.id) ?? []
              return (
                <Collapsible key={f.id} open={f.expanded} onOpenChange={() => toggleFolder(f.id)}>
                  <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70">
                    <ChevronRight
                      className={cn('size-3.5 text-muted-foreground transition-transform', f.expanded && 'rotate-90')}
                    />
                    <FolderIcon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate text-left">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
                    {items.length === 0 && (
                      <div className="px-2 py-1 text-xs text-muted-foreground">Empty</div>
                    )}
                    {items.map((c) => (
                      <ChatRow key={c.id} chat={c} active={c.id === chatId} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
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
                      <ChatRow key={c.id} chat={c} active={c.id === chatId} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </ScrollArea>

      {/* user footer */}
      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-10 w-full cursor-pointer items-center overflow-hidden rounded-lg text-left hover:bg-sidebar-accent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-zinc-700 text-[11px] font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900">
                    IT
                  </AvatarFallback>
                </Avatar>
              </span>
              <div
                className={cn(
                  'min-w-0 flex-1 whitespace-nowrap pr-2 transition-[opacity,transform] ease-[cubic-bezier(0.4,0,0.2,1)]',
                  sidebarTextTransition
                )}
              >
                <div className="truncate text-sm font-medium">Isaac Thoman</div>
                <div className="truncate text-xs text-muted-foreground">isaac@pulpo.dev</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigator.clipboard?.writeText('https://pulpo.dev/u/token-isaac').catch(() => {})}
            >
              <Copy />
              Copy usage portal link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/usage')}>
              <BarChart3 />
              Usage dashboard
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <ArchivedItem />
            <DropdownMenuItem onClick={() => navigate('/admin')}>
              <ShieldCheck />
              Admin panel
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2 />
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

function ArchivedItem() {
  const chats = useChat((s) => s.chats)
  const archived = chats.filter((c) => c.archived)
  const toggleArchive = useChat((s) => s.toggleArchive)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Archive />
        Archived
        <span className="ml-auto text-xs text-muted-foreground">{archived.length}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {archived.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No archived chats</div>
        )}
        {archived.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => toggleArchive(c.id)}>
            <span className="flex-1 truncate">{c.title}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
