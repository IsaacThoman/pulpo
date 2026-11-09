import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import {
  ArrowRightToLine,
  ChevronDown,
  CopyPlus,
  HardDrive,
  History,
  ListX,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { useDocumentTitle } from '@/lib/document-title'
import { isDesktopRuntime } from '@/lib/runtime'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { isAppleShortcut, shortcutLabel } from '@/features/files/browser/shortcuts'
import { useFileOperations } from '@/features/files/browser/use-file-operations'
import { movesIntoItself } from '@/features/files/ancestry'
import { useFilesPageRequest } from '@/features/files/files-page-request'
import { isSidebarItemDrag, readSidebarItems } from '@/features/sidebar/drag-data'
import { useSidePanel } from '@/features/side-panel/store'
import { openBeside, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { trashFolderNode, trashLocation } from '@/features/trash/folder'
import { canCloseTab, groupRange, locationNodeId, updateSnapshots, type FilesLocation, type FilesTab, type TabSnapshot } from './model'
import { useLiveTabNodes } from './live-nodes'
import { FILES_TAB_PANEL_ID, filesTabElementId, type FilesTabActions } from './routing'
import { updateFilesTabs, useFilesTabs } from './store'

/** Pointer travel before pressing a tab becomes dragging it. */
const DRAG_THRESHOLD_PX = 5
const AUTOSCROLL_EDGE_PX = 40
const AUTOSCROLL_MAX_SPEED = 14
const SHIFT_MS = 150
const SETTLE_MS = 180
const PINNED_WIDTH = 40
const TAB_WIDTH = 224
const TAB_MIN_WIDTH = 56

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

/** What a tab takes when items are dropped on it: its folder (`root` for My files); files take nothing. */
function dropTargetOf(location: FilesLocation): string | undefined {
  if (location.kind === 'file') return undefined
  return location.id ?? 'root'
}

function tabTitle(tab: FilesTab, node: TabSnapshot | null | undefined): string {
  const { location } = tab
  if (location.kind === 'folder' && location.id === null) return ui("My files")
  if (location.kind === 'folder' && location.id === 'trash') return ui("Trash")
  if (node) return node.name
  return location.kind === 'folder' ? ui("Folder") : ui("File")
}

function TabIcon({ tab, node, className }: { tab: FilesTab; node: TabSnapshot | null | undefined; className?: string }) {
  const trashColor = useSettings((state) => state.trashColor)
  const { location } = tab
  if (location.kind === 'folder' && location.id === null) return <HardDrive aria-hidden className={cn('shrink-0 text-muted-foreground', className)} />
  if (location.kind === 'folder' && location.id === 'trash') return <FileNodeIcon node={trashFolderNode(ui("Trash"), trashColor)} className={className} />
  const shown = node ?? { kind: location.kind === 'folder' ? 'folder' as const : 'blob' as const, name: '', mimeType: null }
  return <FileNodeIcon node={shown} className={className} />
}

interface DragSession {
  id: string
  pointerId: number
  startX: number
  startScroll: number
  from: number
  to: number
  started: boolean
  rects: DOMRect[]
  ids: string[]
  range: { start: number; end: number }
  frame: number
  lastX: number
  detach: () => void
}

type MenuState = { point: ContextMenuPoint; tabId: string | null }

/**
 * The Files tabs, as in a browser: each tab keeps its own place in Files. Tabs are reordered by
 * dragging (pinned tabs stay first), closed with their × or a middle-click, and take items
 * dropped on folder tabs. The view below shows the active tab.
 */
export function FilesTabStrip({ actions }: { actions: FilesTabActions }) {
  const tabs = useFilesTabs((state) => state.tabs)
  const activeId = useFilesTabs((state) => state.activeId)
  const closed = useFilesTabs((state) => state.closed)
  const ops = useFileOperations()
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const goMain = useMainNavigate()
  const splitAvailable = useSidePanel((state) => state.splitAvailable)
  const desktop = isDesktopRuntime()

  const nodeIds = tabs.map((tab) => locationNodeId(tab.location)).filter((id): id is string => Boolean(id))
  const live = useLiveTabNodes(nodeIds)
  // Tabs remember how their folders and files looked, for the next time this window opens.
  useEffect(() => {
    if (live.size) updateFilesTabs((data) => updateSnapshots(data, live))
  }, [live, tabs])
  const nodeOf = (tab: FilesTab) => {
    const id = locationNodeId(tab.location)
    return id ? live.get(id) ?? tab.snapshot : null
  }
  const titleOf = (tab: FilesTab) => tabTitle(tab, nodeOf(tab))

  const active = tabs.find((tab) => tab.id === activeId)
  useDocumentTitle(active ? titleOf(active) : null)

  const stripRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const wrappers = useRef(new Map<string, HTMLDivElement>())
  const tabElements = useRef(new Map<string, HTMLDivElement>())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropHoverId, setDropHoverId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // After closing a tab with the pointer, tabs keep their width until the pointer leaves the strip,
  // so the next tab's × slides under it, as in browsers.
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null)
  const drag = useRef<DragSession | null>(null)
  const settle = useRef<{ id: string; left: number } | null>(null)
  const lastPointerType = useRef('mouse')

  const focusable = focusId && tabs.some((tab) => tab.id === focusId) ? focusId : activeId
  const closable = (tab: FilesTab) => canCloseTab({ tabs, activeId, closed }, tab.id)
  // The tab to give focus back to when a menu opened from the keyboard closes (see `closeMenu`).
  const menuReturn = useRef<{ id: string; index: number } | null>(null)

  // The active tab scrolls into view when it changes, and is where Tab enters the strip next,
  // unless focus is moving between tabs right now.
  useEffect(() => {
    tabElements.current.get(activeId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    if (!listRef.current?.contains(document.activeElement)) setFocusId(null)
  }, [activeId])

  // The active tab stays in view as the strip narrows (a smaller window, the sidebar opening).
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!drag.current) tabElements.current.get(useFilesTabs.getState().activeId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  // A drop animates the dragged tab from where it was let go into its new place.
  useLayoutEffect(() => {
    const done = settle.current
    if (!done) return
    settle.current = null
    const element = wrappers.current.get(done.id)
    if (!element) return
    const delta = done.left - element.getBoundingClientRect().left
    if (!delta || reducedMotion()) return
    element.style.transition = 'none'
    element.style.transform = `translateX(${delta}px)`
    void element.getBoundingClientRect()
    // The app's animation speed retimes CSS transitions itself (lib/animation-speed).
    element.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`
    element.style.transform = ''
    const clear = (event: TransitionEvent) => {
      if (event.target !== element || event.propertyName !== 'transform') return
      element.style.transition = ''
      element.removeEventListener('transitionend', clear)
    }
    element.addEventListener('transitionend', clear)
  }, [tabs])

  useEffect(() => () => drag.current?.detach(), [])

  const focusTab = (id: string | undefined) => {
    if (!id) return
    setFocusId(id)
    requestAnimationFrame(() => tabElements.current.get(id)?.focus())
  }

  const closeWithPointer = (tab: FilesTab) => {
    const width = wrappers.current.get(tab.id)?.getBoundingClientRect().width
    // Closing the last tab leaves nothing to slide under the pointer; a touch leaves no pointer
    // behind to move away and release the widths.
    if (width && !tab.pinned && tabs.at(-1) !== tab && lastPointerType.current !== 'touch') setFrozenWidth(width)
    actions.close(tab.id)
  }

  /** Closes the tab menu; one opened from the keyboard gives focus back to its tab (or its neighbor). */
  const closeMenu = () => {
    setMenu(null)
    const back = menuReturn.current
    menuReturn.current = null
    if (!back) return
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body && active.isConnected) return
      const { tabs: now } = useFilesTabs.getState()
      focusTab((now.find((tab) => tab.id === back.id) ?? now[Math.min(back.index, now.length - 1)])?.id)
    })
  }

  const announceMove = (tab: FilesTab, index: number) => setAnnouncement(uit`Moved ${titleOf(tab)} to position ${index + 1} of ${tabs.length}`)

  const shiftDuration = () => SHIFT_MS

  /** Lays the other tabs out around the dragged one and returns where it would land. */
  const layoutDrag = (session: DragSession, clientX: number) => {
    const list = listRef.current
    const scrolled = (list?.scrollLeft ?? 0) - session.startScroll
    const { rects, from, range } = session
    const origin = rects[from]!
    // The dragged tab stays within its group (pinned or not).
    const min = rects[range.start]!.left - origin.left
    const max = rects[range.end]!.right - origin.right
    const offset = Math.min(Math.max(clientX - session.startX + scrolled, min), max)
    wrappers.current.get(session.id)?.style.setProperty('transform', `translateX(${offset}px)`)
    const center = origin.left + origin.width / 2 + offset
    let to = from
    for (let index = range.start; index <= range.end; index++) {
      if (index === from) continue
      const rect = rects[index]!
      const middle = rect.left + rect.width / 2
      // Reaching a tab's middle passes it; held against the end of its group, a tab reaches the last.
      if (index > from && center >= middle) to = Math.max(to, index)
      if (index < from && center <= middle) to = Math.min(to, index)
    }
    const next = rects[from + 1] ?? rects[from - 1]
    const gap = next ? Math.max(0, next.left > origin.left ? next.left - origin.right : origin.left - next.right) : 0
    const shift = origin.width + gap
    session.ids.forEach((id, index) => {
      if (index === from) return
      const element = wrappers.current.get(id)
      if (!element) return
      const moved = from < to && index > from && index <= to ? -shift : from > to && index >= to && index < from ? shift : 0
      element.style.transform = moved ? `translateX(${moved}px)` : ''
    })
    session.to = to
  }

  const endDrag = (commit: boolean) => {
    const session = drag.current
    if (!session) return
    drag.current = null
    session.detach()
    // Widths kept after a close wait for the pointer to leave the strip, which it may have done mid-press.
    if (!stripRef.current?.matches(':hover')) setFrozenWidth(null)
    if (!session.started) return
    const duration = reducedMotion() ? 0 : shiftDuration()
    const element = wrappers.current.get(session.id)
    if (commit && session.to !== session.from) {
      // Remember where the tab was let go, then put everything in its real place at once.
      settle.current = { id: session.id, left: element?.getBoundingClientRect().left ?? 0 }
      for (const id of session.ids) {
        const wrapper = wrappers.current.get(id)
        if (!wrapper) continue
        wrapper.style.transition = 'none'
        wrapper.style.transform = ''
      }
      const tab = tabs.find((candidate) => candidate.id === session.id)
      actions.move(session.id, session.to)
      if (tab) announceMove(tab, session.to)
      requestAnimationFrame(() => {
        for (const id of session.ids) {
          const wrapper = wrappers.current.get(id)
          if (wrapper && id !== session.id) wrapper.style.transition = ''
        }
      })
    } else {
      for (const id of session.ids) {
        const wrapper = wrappers.current.get(id)
        if (!wrapper) continue
        wrapper.style.transition = duration ? `transform ${duration}ms cubic-bezier(0.2, 0, 0, 1)` : 'none'
        wrapper.style.transform = ''
      }
    }
    setDraggingId(null)
  }

  const startPointer = (event: PointerEvent<HTMLDivElement>, tab: FilesTab, index: number) => {
    lastPointerType.current = event.pointerType
    // A middle-click closes the tab (on release); keep the browser from starting autoscroll.
    if (event.button === 1) { event.preventDefault(); return }
    // Control-click is a right-click on a Mac.
    if (event.button !== 0 || (event.ctrlKey && isAppleShortcut())) return
    if ((event.target as Element).closest('[data-tab-close]')) return
    // Tabs show on press, as in browsers; touch waits for the tap so the strip can scroll.
    if (event.pointerType === 'touch') return
    actions.select(tab.id)
    if (drag.current) return
    const ids = tabs.map((candidate) => candidate.id)
    const rects = ids.map((id) => wrappers.current.get(id)?.getBoundingClientRect() ?? new DOMRect())
    const list = listRef.current
    const session: DragSession = {
      id: tab.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: list?.scrollLeft ?? 0,
      from: index,
      to: index,
      started: false,
      rects,
      ids,
      range: groupRange(tabs, tab.pinned),
      frame: 0,
      lastX: event.clientX,
      detach: () => {},
    }
    const autoscroll = () => {
      session.frame = requestAnimationFrame(autoscroll)
      if (!list || list.scrollWidth <= list.clientWidth) return
      const bounds = list.getBoundingClientRect()
      const x = session.lastX
      const speed = x < bounds.left + AUTOSCROLL_EDGE_PX
        ? -Math.ceil(AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, x - bounds.left) / AUTOSCROLL_EDGE_PX))
        : x > bounds.right - AUTOSCROLL_EDGE_PX
          ? Math.ceil(AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, bounds.right - x) / AUTOSCROLL_EDGE_PX))
          : 0
      if (!speed) return
      list.scrollLeft += speed
      layoutDrag(session, x)
    }
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return
      session.lastX = moveEvent.clientX
      if (!session.started) {
        if (Math.abs(moveEvent.clientX - session.startX) < DRAG_THRESHOLD_PX) return
        session.started = true
        setDraggingId(session.id)
        document.body.style.userSelect = 'none'
        window.getSelection()?.removeAllRanges()
        const duration = reducedMotion() ? 0 : shiftDuration()
        for (const id of ids) {
          const wrapper = wrappers.current.get(id)
          if (wrapper) wrapper.style.transition = id === session.id || !duration ? 'none' : `transform ${duration}ms cubic-bezier(0.2, 0, 0, 1)`
        }
        session.frame = requestAnimationFrame(autoscroll)
      }
      moveEvent.preventDefault()
      layoutDrag(session, moveEvent.clientX)
    }
    const up = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== session.pointerId) return
      endDrag(upEvent.type === 'pointerup')
    }
    const key = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== 'Escape' || !session.started) return
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      endDrag(false)
    }
    session.detach = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', key, true)
      cancelAnimationFrame(session.frame)
      document.body.style.userSelect = ''
    }
    drag.current = session
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key, true)
  }

  const openMenuAt = (point: ContextMenuPoint, tabId: string | null) => {
    menuReturn.current = null
    setMenu({ point, tabId })
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tab: FilesTab, index: number) => {
    const { key } = event
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && event.altKey && !event.metaKey && !event.ctrlKey) {
      // Alt+Arrow moves the tab, within its group, keeping focus on it.
      event.preventDefault()
      const { start, end } = groupRange(tabs, tab.pinned)
      const to = Math.min(Math.max(index + (key === 'ArrowLeft' ? -1 : 1), start), end)
      if (to === index) return
      actions.move(tab.id, to)
      announceMove(tab, to)
      focusTab(tab.id)
      return
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      const next = (index + (key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length
      focusTab(tabs[next]?.id)
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault()
      focusTab((key === 'Home' ? tabs[0] : tabs.at(-1))?.id)
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      actions.select(tab.id)
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault()
      if (!closable(tab)) return
      const after = actions.close(tab.id)
      focusTab(after.tabs[Math.min(index, after.tabs.length - 1)]?.id)
    } else if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      openMenuAt({ x: rect.left, y: rect.bottom }, tab.id)
      menuReturn.current = { id: tab.id, index }
    }
  }

  /** Folder tabs take sidebar items (moved there) and files from the computer (uploaded there). */
  const dropHandlers = (tab: FilesTab) => {
    const target = dropTargetOf(tab.location)
    if (target === undefined) return {}
    const folderId = target === 'root' ? null : target
    const intoTrash = trashLocation(folderId) !== null
    const accepts = (event: DragEvent) => isSidebarItemDrag(event.dataTransfer) || (isFileDrag(event) && !intoTrash)
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        // The sidebar only allows moves.
        event.dataTransfer.dropEffect = isSidebarItemDrag(event.dataTransfer) ? 'move' : 'copy'
        setDropHoverId(tab.id)
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropHoverId(null)
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        setDropHoverId(null)
        if (isSidebarItemDrag(event.dataTransfer)) {
          const nodes = readSidebarItems(event.dataTransfer).filter((node) => !movesIntoItself(queryClient, userId, folderId, [node]))
          if (!nodes.length) return
          if (intoTrash) void ops.trash(nodes)
          else void ops.move(nodes, folderId)
          return
        }
        const files = [...event.dataTransfer.files]
        if (!files.length) return
        // The tab's own view uploads them, with its progress and the new files selected.
        useFilesPageRequest.setState({ request: { kind: 'upload', files, folderId } })
        actions.select(tab.id)
      },
    }
  }

  // Anything else dropped on the strip is refused, so the browser does not open a dropped file.
  const refuseDrop = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(event) && !isSidebarItemDrag(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (isFileDrag(event) || isSidebarItemDrag(event.dataTransfer)) event.preventDefault()
    },
  }

  const desktopShortcut = (key: string, shift = false) => desktop ? <DropdownMenuShortcut>{shortcutLabel(key, { mod: true, shift })}</DropdownMenuShortcut> : null
  const menuTab = menu?.tabId ? tabs.find((tab) => tab.id === menu.tabId) : undefined
  const menuIndex = menuTab ? tabs.indexOf(menuTab) : -1
  const hasOthers = Boolean(menuTab) && tabs.some((tab) => tab !== menuTab && !tab.pinned)
  const hasRight = menuIndex >= 0 && tabs.slice(menuIndex + 1).some((tab) => !tab.pinned)
  const reopenItem = (
    <DropdownMenuItem disabled={!closed.length} onSelect={() => actions.reopen()}>
      <History /> {ui("Reopen closed tab")}{desktopShortcut('T', true)}
    </DropdownMenuItem>
  )

  const renderTab = (tab: FilesTab, index: number): ReactNode => {
    const isActive = tab.id === activeId
    const previousActive = tabs[index - 1]?.id === activeId
    const node = nodeOf(tab)
    const title = titleOf(tab)
    const dragging = draggingId === tab.id
    const width = tab.pinned ? PINNED_WIDTH : frozenWidth ?? TAB_WIDTH
    return (
      <div
        key={tab.id}
        ref={(element) => {
          if (element) wrappers.current.set(tab.id, element)
          else wrappers.current.delete(tab.id)
        }}
        data-files-tab=""
        className={cn(
          'files-tab relative flex h-full shrink items-center px-px',
          // A hairline between tabs, hidden next to the active tab and the one under the pointer.
          'before:absolute before:top-1/2 before:left-0 before:h-4 before:w-px before:-translate-y-1/2 before:bg-border before:transition-opacity',
          (index === 0 || isActive || previousActive || draggingId) && 'before:opacity-0',
          'hover:before:opacity-0 [.files-tab:hover+&]:before:opacity-0',
          dragging && 'z-10',
        )}
        style={{ flex: tab.pinned || frozenWidth ? `0 0 ${width}px` : `0 1 ${TAB_WIDTH}px`, minWidth: tab.pinned ? PINNED_WIDTH : TAB_MIN_WIDTH }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              ref={(element) => {
                if (element) tabElements.current.set(tab.id, element)
                else tabElements.current.delete(tab.id)
              }}
              role="tab"
              id={filesTabElementId(tab.id)}
              aria-selected={isActive}
              // Pinned and crowded tabs show only an icon, so the title names them.
              aria-label={title}
              aria-controls={isActive ? FILES_TAB_PANEL_ID : undefined}
              aria-keyshortcuts="Delete Alt+ArrowLeft Alt+ArrowRight"
              tabIndex={focusable === tab.id ? 0 : -1}
              data-drop-target={dropTargetOf(tab.location)}
              data-active={isActive || undefined}
              data-pinned={tab.pinned || undefined}
              data-drop-active={dropHoverId === tab.id || undefined}
              className={cn(
                'desktop-no-drag group/tab @container relative flex h-8 w-full min-w-0 cursor-default items-center rounded-lg text-[13px] leading-none outline-none select-none',
                'transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                isActive
                  ? 'bg-background text-foreground shadow-xs ring-1 ring-border/70 dark:ring-white/10'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                dragging && 'shadow-md',
                // Items dragged over a folder tab (see useItemDrag, and the drop handlers here).
                'data-[drop-active]:bg-sky-500/20 data-[drop-active]:ring-2 data-[drop-active]:ring-sky-500/60 data-[drop-hover]:bg-sky-500/20 data-[drop-hover]:ring-2 data-[drop-hover]:ring-sky-500/60',
              )}
              onFocus={() => setFocusId(tab.id)}
              onPointerDown={(event) => startPointer(event, tab, index)}
              onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
              onClick={(event) => {
                // Mouse presses already showed the tab; taps and assistive technology clicks show it here.
                if (lastPointerType.current !== 'mouse' || event.detail === 0) actions.select(tab.id)
                lastPointerType.current = 'mouse'
              }}
              onAuxClick={(event: MouseEvent) => {
                if (event.button !== 1) return
                event.preventDefault()
                if (closable(tab)) closeWithPointer(tab)
              }}
              onKeyDown={(event) => onTabKeyDown(event, tab, index)}
              onContextMenu={(event) => {
                event.preventDefault()
                openMenuAt({ x: event.clientX, y: event.clientY }, tab.id)
              }}
              {...dropHandlers(tab)}
            >
              {/* Crowded tabs show only their icon; the active one shows its × instead, as in browsers. */}
              <span className={cn('flex h-full min-w-0 flex-1 items-center gap-2', tab.pinned ? 'justify-center' : 'pr-1 pl-2.5 @max-[4.5rem]:justify-center @max-[4.5rem]:px-0')}>
                <TabIcon tab={tab} node={node} className={cn('size-4', isActive && !tab.pinned && closable(tab) && '@max-[4.5rem]:hidden')} />
                {!tab.pinned && (
                  <span className="min-w-0 flex-1 truncate py-1 @max-[4.5rem]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] [text-overflow:clip]">
                    {title}
                  </span>
                )}
                {!tab.pinned && closable(tab) && (
                  // Pointer-only: keyboard users close the focused tab with Delete, or from its menu.
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    data-tab-close=""
                    className={cn(
                      'grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                      // Shown on hover only, so a touch on that spot selects the tab rather than closing it.
                      !isActive && 'pointer-events-none opacity-0 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 @max-[4.5rem]:hidden',
                    )}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      lastPointerType.current = event.pointerType
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeWithPointer(tab)
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </span>
            </div>
          </TooltipTrigger>
          {!draggingId && <TooltipContent side="bottom">{title}</TooltipContent>}
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      ref={stripRef}
      className="files-tab-bar flex shrink-0 items-center gap-1 bg-sidebar px-4"
      data-dragging={draggingId ? '' : undefined}
      onPointerLeave={() => { if (!drag.current) setFrozenWidth(null) }}
      onDoubleClick={(event) => {
        // Double-clicking empty strip space opens a tab (the desktop window zooms there instead).
        // Menus render in portals; React still bubbles their events up to here.
        if (desktop || !event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('[role="tab"], button')) return
        actions.newTab()
      }}
      onContextMenu={(event) => {
        if (!event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('[role="tab"]')) return
        event.preventDefault()
        openMenuAt({ x: event.clientX, y: event.clientY }, null)
      }}
      {...refuseDrop}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label={ui("Files tabs")}
        aria-orientation="horizontal"
        className="flex h-full min-w-0 items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        // The width the tabs would like; the strip shrinks it (and with it the tabs) when there is less room.
        style={{ width: tabs.reduce((total, tab) => total + (tab.pinned ? PINNED_WIDTH : frozenWidth ?? TAB_WIDTH), 0) }}
        onWheel={(event) => {
          const list = event.currentTarget
          if (list.scrollWidth > list.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) list.scrollLeft += event.deltaY
        }}
      >
        {tabs.map(renderTab)}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="desktop-no-drag size-7 shrink-0 hover:bg-sidebar-accent" aria-label={ui("New tab")} onClick={() => actions.newTab()}>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{desktop ? `${ui("New tab")} · ${shortcutLabel('T', { mod: true })}` : ui("New tab")}</TooltipContent>
      </Tooltip>
      <div className="min-w-2 flex-1 self-stretch" />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="desktop-no-drag size-7 shrink-0 hover:bg-sidebar-accent" aria-label={ui("List all tabs")}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{ui("List all tabs")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Open tabs")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeId} onValueChange={(id) => actions.select(id)}>
            {tabs.map((tab) => (
              <DropdownMenuRadioItem key={tab.id} value={tab.id}>
                <TabIcon tab={tab} node={nodeOf(tab)} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{titleOf(tab)}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {closed.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Recently closed")}</DropdownMenuLabel>
              {closed.map((entry, at) => ({ entry, at })).slice(-8).reverse().map(({ entry, at }) => {
                const first = entry.tabs.at(-1)!.tab
                const title = tabTitle(first, first.snapshot)
                return (
                  <DropdownMenuItem key={`${at}:${first.id}`} onSelect={() => actions.reopen(at)}>
                    <TabIcon tab={first} node={first.snapshot} className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{entry.tabs.length > 1 ? uit`${title} and ${entry.tabs.length - 1} more` : title}</span>
                  </DropdownMenuItem>
                )
              })}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FileContextMenu point={menu?.point ?? null} onClose={closeMenu}>
        {menuTab ? (
          <>
            <DropdownMenuItem onSelect={() => actions.newTab(undefined, { index: menuIndex + 1 })}><Plus /> {ui("New tab to the right")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.duplicate(menuTab.id)}><CopyPlus /> {ui("Duplicate")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.pin(menuTab.id, !menuTab.pinned)}>
              {menuTab.pinned ? <PinOff /> : <Pin />} {menuTab.pinned ? ui("Unpin tab") : ui("Pin tab")}
            </DropdownMenuItem>
            {/* The active tab's file is already open here; one file opens in one view at a time. */}
            {splitAvailable && !(menuTab.id === activeId && menuTab.location.kind === 'file') && <DropdownMenuItem onSelect={() => openBeside(menuTab.location, goMain)}><PanelRight /> {ui("Open to the right")}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!closable(menuTab)} onSelect={() => actions.close(menuTab.id)}><X /> {ui("Close tab")}{desktopShortcut('W')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!hasOthers} onSelect={() => actions.closeOthers(menuTab.id)}><ListX /> {ui("Close other tabs")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!hasRight} onSelect={() => actions.closeToRight(menuTab.id)}><ArrowRightToLine /> {ui("Close tabs to the right")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            {reopenItem}
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => actions.newTab()}><Plus /> {ui("New tab")}{desktopShortcut('T')}</DropdownMenuItem>
            {reopenItem}
          </>
        )}
      </FileContextMenu>
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  )
}
