import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightToLine, CopyPlus, HardDrive, ListX, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { fetchFileNode, fileNodeQueryKey } from '@/features/files/api'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { panelContentPath, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { trashLocation } from '@/features/trash/folder'
import { filesTabs, useFilesTabs, type FilesTab, type FilesTabContent } from './tabs'

const TAB_DRAG_TYPE = 'application/x-pulpo-files-tab'

/** The stored item a tab shows, if any: My files and the trash are not stored nodes. */
function storedId(content: FilesTabContent): string | null {
  if (content.kind === 'file') return content.id
  const trash = trashLocation(content.id)
  return trash ? trash.folderId : content.id
}

/** A tab's icon and name, read like the views read them, so renames and colors show here too. */
function useTabLabel(userId: string, content: FilesTabContent) {
  const id = storedId(content)
  const query = useQuery({ queryKey: fileNodeQueryKey(userId, id ?? ''), queryFn: () => fetchFileNode(id!), enabled: Boolean(id) })
  const node = query.data?.node
  if (!id) {
    const trash = trashLocation(content.kind === 'folder' ? content.id : null)
    return trash
      ? { name: ui("Trash"), icon: <Trash2 className="size-4 shrink-0 text-muted-foreground" /> }
      : { name: ui("My files"), icon: <HardDrive className="size-4 shrink-0 text-muted-foreground" /> }
  }
  if (!node) return { name: query.isError ? ui("Unavailable") : ui("Loading…"), icon: <span className="size-4 shrink-0" /> }
  return { name: node.name, icon: <FileNodeIcon node={node} className="size-4" /> }
}

function TabButton({ tab, userId, active, dropActive, dropBefore, onSelect, onClose, onMenu, onDragStart, onDragEnd }: {
  tab: FilesTab
  userId: string
  active: boolean
  dropActive: boolean
  /** Shows where a tab being dragged would land: before this one. */
  dropBefore: boolean
  onSelect: () => void
  onClose: () => void
  onMenu: (point: ContextMenuPoint) => void
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
}) {
  const label = useTabLabel(userId, tab.content)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  const folderTarget = tab.content.kind === 'folder' ? tab.content.id ?? 'root' : undefined
  return (
    <div
      ref={ref}
      role="presentation"
      data-files-tab={tab.id}
      // Folder tabs take items dragged within Files, like the folder path does (see useItemDrag).
      data-drop-target={folderTarget}
      className={cn(
        'group relative flex h-7 min-w-28 max-w-60 flex-1 basis-0 items-center rounded-md text-sm transition-colors',
        active ? 'bg-background font-medium text-foreground shadow-xs ring-1 ring-border' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        dropActive && 'bg-sky-500/20 text-foreground ring-2 ring-sky-500/60',
        dropBefore && 'before:absolute before:inset-y-1 before:-left-[3px] before:w-0.5 before:rounded-full before:bg-sky-500',
      )}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        role="tab"
        id={`files-tab-${tab.id}`}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={label.name}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onSelect}
        // Middle-click closes a tab, as in browsers; the press must not start autoscrolling.
        onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
        onAuxClick={(event: MouseEvent) => { if (event.button === 1) { event.preventDefault(); onClose() } }}
        className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 rounded-md pr-7 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label.icon}
        <span className="min-w-0 flex-1 truncate">{label.name}</span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={ui("Close tab")}
        title={ui("Close tab")}
        onClick={onClose}
        className={cn(
          'absolute right-1 grid size-5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
          // Touch has no hover, so the button always shows there.
          !active && 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * The main Files view's tabs, under its header, as in Finder: shown once more than one is open.
 * Each tab is a folder or file; browsing moves the active tab, and the others keep their places.
 * `dropTarget` is the folder that items being dragged in the browser would drop into.
 */
export function FilesTabBar({ dropTarget = null }: { dropTarget?: string | null }) {
  const userId = useAuth((state) => state.user?.id)
  const { tabs, activeId, userId: owner } = useFilesTabs()
  const go = useMainNavigate()
  const [menu, setMenu] = useState<{ point: ContextMenuPoint; tab: FilesTab } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  if (!userId || owner !== userId || tabs.length < 2) return null

  const show = (tab: FilesTab | null | undefined) => { if (tab) go(panelContentPath(tab.content)) }
  const select = (tab: FilesTab) => {
    if (tab.id === activeId) return
    filesTabs.activate(userId, tab.id)
    show(tab)
  }
  const close = (ids: string[]) => {
    const before = activeId
    const next = filesTabs.close(userId, ids)
    if (next.activeId !== before) show(next.tabs.find((tab) => tab.id === next.activeId))
  }
  const newTab = () => {
    const content: FilesTabContent = { kind: 'folder', id: null }
    filesTabs.add(userId, content)
    go(panelContentPath(content))
  }

  // Left/Right move between tabs, Home/End go to the ends; the browser's own keys stay with it.
  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === activeId)
    const target = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (target === null) return
    event.preventDefault()
    const tab = tabs[Math.max(0, Math.min(target, tabs.length - 1))]!
    select(tab)
    document.getElementById(`files-tab-${tab.id}`)?.focus()
  }

  /** Where a tab dragged over the bar would land: before the first tab whose middle is past the pointer. */
  const indexAt = (x: number) => {
    const elements = [...listRef.current?.querySelectorAll<HTMLElement>('[data-files-tab]') ?? []]
    const at = elements.findIndex((element) => {
      const rect = element.getBoundingClientRect()
      return x < rect.left + rect.width / 2
    })
    return at < 0 ? elements.length : at
  }
  const dragProps = {
    onDragOver: (event: DragEvent) => {
      if (!dragging || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropIndex(indexAt(event.clientX))
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null)
    },
    onDrop: (event: DragEvent) => {
      if (!dragging || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
      event.preventDefault()
      const at = indexAt(event.clientX)
      const from = tabs.findIndex((tab) => tab.id === dragging)
      // Indexes count the dragged tab, which leaves its own place first.
      filesTabs.move(userId, dragging, at > from ? at - 1 : at)
      setDragging(null)
      setDropIndex(null)
    },
  }
  const menuTab = menu?.tab
  const menuIndex = menuTab ? tabs.findIndex((tab) => tab.id === menuTab.id) : -1

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/40 px-2" {...dragProps}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ui("Files tabs")}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => (
          <TabButton
            key={tab.id}
            tab={tab}
            userId={userId}
            active={tab.id === activeId}
            dropActive={dropTarget !== null && tab.content.kind === 'folder' && dropTarget === (tab.content.id ?? 'root')}
            dropBefore={dragging !== null && dropIndex === index && dragging !== tab.id && tabs[index - 1]?.id !== dragging}
            onSelect={() => select(tab)}
            onClose={() => close([tab.id])}
            onMenu={(point) => setMenu({ point, tab })}
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id)
              event.dataTransfer.effectAllowed = 'move'
              setDragging(tab.id)
            }}
            onDragEnd={() => { setDragging(null); setDropIndex(null) }}
          />
        ))}
        {dragging !== null && dropIndex === tabs.length && tabs.at(-1)?.id !== dragging && <span aria-hidden className="h-5 w-0.5 shrink-0 rounded-full bg-sky-500" />}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label={ui("New tab")} onClick={newTab}><Plus /></Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{ui("New tab")}</TooltipContent>
      </Tooltip>
      <FileContextMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menuTab && (
          <>
            <DropdownMenuItem onSelect={() => { filesTabs.add(userId, menuTab.content, { after: menuTab.id }); show(menuTab) }}><CopyPlus /> {ui("Duplicate tab")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => close([menuTab.id])}><X /> {ui("Close tab")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => close(tabs.filter((tab) => tab.id !== menuTab.id).map((tab) => tab.id))}><ListX /> {ui("Close other tabs")}</DropdownMenuItem>
            <DropdownMenuItem disabled={menuIndex === tabs.length - 1} onSelect={() => close(tabs.slice(menuIndex + 1).map((tab) => tab.id))}><ArrowRightToLine /> {ui("Close tabs to the right")}</DropdownMenuItem>
          </>
        )}
      </FileContextMenu>
    </div>
  )
}
