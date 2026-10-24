import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightToLine, CopyPlus, HardDrive, ListX, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { attachmentQueryKey, fetchAttachment } from '@/components/chat/attachment-actions'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { fetchFileNode, fileNodeQueryKey } from '@/features/files/api'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { useItemDropTarget } from '@/features/files/browser/use-item-drag'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { trashLocation } from '@/features/trash/folder'
import type { PaneTab } from './pane-tabs'
import type { PanelContent } from './store'

const TAB_DRAG_TYPE = 'application/x-pulpo-pane-tab'

/** The stored Files item a tab shows, if any: My files and the trash are not stored nodes. */
function storedId(content: PanelContent): string | null {
  if (content.kind === 'file') return content.id
  if (content.kind === 'attachment') return null
  const trash = trashLocation(content.id)
  return trash ? trash.folderId : content.id
}

const iconClass = 'size-4 shrink-0 text-muted-foreground'

/** A tab's icon and name, read like the views read them, so renames and colors show here too. */
function useTabLabel(userId: string, content: PanelContent): { name: string; icon: ReactNode } {
  const id = storedId(content)
  const node = useQuery({ queryKey: fileNodeQueryKey(userId, id ?? ''), queryFn: () => fetchFileNode(id!), enabled: Boolean(id) })
  const attachmentId = content.kind === 'attachment' ? content.id : null
  const attachment = useQuery({ queryKey: attachmentQueryKey(userId, attachmentId ?? ''), queryFn: () => fetchAttachment(attachmentId!), enabled: Boolean(attachmentId) })
  const pending = { name: ui("Loading…"), icon: <span className="size-4 shrink-0" /> }
  if (attachmentId) {
    const data = attachment.data
    if (!data) return attachment.isError ? { ...pending, name: ui("Unavailable") } : pending
    return { name: data.name, icon: <FileNodeIcon node={{ kind: 'blob', name: data.name, mimeType: data.mimeType }} className="size-4" /> }
  }
  if (!id) {
    return trashLocation(content.kind === 'folder' ? content.id : null)
      ? { name: ui("Trash"), icon: <Trash2 className={iconClass} /> }
      : { name: ui("My files"), icon: <HardDrive className={iconClass} /> }
  }
  const data = node.data?.node
  if (!data) return node.isError ? { ...pending, name: ui("Unavailable") } : pending
  return { name: data.name, icon: <FileNodeIcon node={data} className="size-4" /> }
}

function Tab({ tab, userId, active, closable, dropActive, dropBefore, onSelect, onClose, onMenu, onDragStart, onDragEnd }: {
  tab: PaneTab
  userId: string
  active: boolean
  closable: boolean
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
  return (
    <div
      ref={ref}
      role="presentation"
      data-pane-tab={tab.id}
      // Folder tabs take items dragged within Files, like the folder path does (see useItemDrag).
      data-drop-target={tab.content.kind === 'folder' ? tab.content.id ?? 'root' : undefined}
      className={cn(
        // Tabs shrink as more open, like browser tabs, then the row scrolls.
        'group relative flex h-8 w-52 min-w-24 shrink items-center rounded-lg text-sm transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        dropActive && 'bg-sky-500/20 text-foreground ring-2 ring-sky-500/60',
        dropBefore && 'before:absolute before:inset-y-1.5 before:-left-[3px] before:w-0.5 before:rounded-full before:bg-sky-500',
      )}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        role="tab"
        id={`pane-tab-${tab.id}`}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={label.name}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onSelect}
        // Middle-click closes a tab, as in browsers; the press must not start autoscrolling.
        onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
        onAuxClick={(event) => { if (event.button === 1 && closable) { event.preventDefault(); onClose() } }}
        className={cn('flex h-full min-w-0 flex-1 cursor-default items-center gap-2 rounded-lg pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', closable ? 'pr-7' : 'pr-2.5')}
      >
        {label.icon}
        <span className="min-w-0 flex-1 truncate">{label.name}</span>
      </button>
      {closable && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={ui("Close tab")}
          title={ui("Close tab")}
          onClick={onClose}
          className={cn(
            'absolute right-1.5 grid size-5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
            // Touch has no hover, so the button always shows there.
            !active && 'sm:opacity-0 sm:group-hover:opacity-100',
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * A view's tabs, along its top edge: the main view's and the side panel's work the same way.
 * Tabs switch on click and with the arrow keys, close with × or a middle-click, reorder by
 * dragging, and take Files items dropped on a folder tab. `actions` sit at the end of the row.
 */
export function PaneTabStrip({ label, tabs, activeId, closeLast, onSelect, onClose, onMove, onNew, onDuplicate, menuItems, actions, className }: {
  label: string
  tabs: PaneTab[]
  activeId: string | null
  /** Whether the last tab can close (closing the side panel's last closes the panel). */
  closeLast: boolean
  onSelect: (tab: PaneTab) => void
  onClose: (ids: string[]) => void
  onMove: (id: string, index: number) => void
  onNew: () => void
  onDuplicate: (tab: PaneTab) => void
  /** More entries for a tab's menu, e.g. moving it to the other view. */
  menuItems?: (tab: PaneTab) => ReactNode
  actions?: ReactNode
  className?: string
}) {
  const userId = useAuth((state) => state.user?.id)
  const dropTarget = useItemDropTarget((state) => state.target)
  const [menu, setMenu] = useState<{ point: ContextMenuPoint; tab: PaneTab } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  if (!userId) return null
  const closable = closeLast || tabs.length > 1

  // Left/Right move between tabs, Home/End go to the ends.
  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === activeId)
    const target = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (target === null) return
    // Handled here, so the Files browser below does not also move its selection.
    event.preventDefault()
    const tab = tabs[Math.max(0, Math.min(target, tabs.length - 1))]
    if (!tab) return
    onSelect(tab)
    document.getElementById(`pane-tab-${tab.id}`)?.focus()
  }

  /** Where a tab dragged over the row would land: before the first tab whose middle is past the pointer. */
  const indexAt = (x: number) => {
    const elements = [...listRef.current?.querySelectorAll<HTMLElement>('[data-pane-tab]') ?? []]
    const at = elements.findIndex((element) => {
      const rect = element.getBoundingClientRect()
      return x < rect.left + rect.width / 2
    })
    return at < 0 ? elements.length : at
  }
  const reordering = (event: DragEvent) => dragging !== null && event.dataTransfer.types.includes(TAB_DRAG_TYPE)
  const menuTab = menu?.tab
  const menuIndex = menuTab ? tabs.findIndex((tab) => tab.id === menuTab.id) : -1

  return (
    <div
      className={cn('flex h-11 shrink-0 items-center gap-1 border-b px-2', className)}
      onDragOver={(event) => {
        if (!reordering(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropIndex(indexAt(event.clientX))
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null)
      }}
      onDrop={(event) => {
        if (!reordering(event)) return
        event.preventDefault()
        const at = indexAt(event.clientX)
        const from = tabs.findIndex((tab) => tab.id === dragging)
        // Indexes count the dragged tab, which leaves its own place first.
        onMove(dragging!, at > from ? at - 1 : at)
        setDragging(null)
        setDropIndex(null)
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            userId={userId}
            active={tab.id === activeId}
            closable={closable}
            dropActive={dropTarget !== null && tab.content.kind === 'folder' && dropTarget === (tab.content.id ?? 'root')}
            dropBefore={dragging !== null && dropIndex === index && dragging !== tab.id && tabs[index - 1]?.id !== dragging}
            onSelect={() => onSelect(tab)}
            onClose={() => onClose([tab.id])}
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
            <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={ui("New tab")} onClick={onNew}><Plus /></Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{ui("New tab")}</TooltipContent>
        </Tooltip>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      <FileContextMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menuTab && (
          <>
            <DropdownMenuItem onSelect={() => onDuplicate(menuTab)}><CopyPlus /> {ui("Duplicate tab")}</DropdownMenuItem>
            {menuItems?.(menuTab)}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!closable} onSelect={() => onClose([menuTab.id])}><X /> {ui("Close tab")}</DropdownMenuItem>
            <DropdownMenuItem disabled={tabs.length < 2} onSelect={() => onClose(tabs.filter((tab) => tab.id !== menuTab.id).map((tab) => tab.id))}><ListX /> {ui("Close other tabs")}</DropdownMenuItem>
            <DropdownMenuItem disabled={menuIndex === tabs.length - 1} onSelect={() => onClose(tabs.slice(menuIndex + 1).map((tab) => tab.id))}><ArrowRightToLine /> {ui("Close tabs to the right")}</DropdownMenuItem>
          </>
        )}
      </FileContextMenu>
    </div>
  )
}
