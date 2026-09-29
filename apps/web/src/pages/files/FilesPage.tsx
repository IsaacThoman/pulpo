import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FILE_SCOPE_ROOT, isMarkdownName, MAX_CHAT_FILE_SCOPES, type FileFolderLayout, type FileGridPosition, type FileListing, type FileNode } from '@pulpo/contracts'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FilePlus2,
  FolderInput,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  Maximize2,
  PanelRight,
  Loader2,
  Pencil,
  Plus,
  Scissors,
  SquareDashedMousePointer,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { createDoc, createFolder, downloadFile, fetchFolder, fetchFolderLayout, folderLayoutQueryKey, folderQueryKey, updateFolderLayout, uploadFile } from '@/features/files/api'
import { arrangeGrid, GRID_CELL, moveInGrid, readingOrder } from '@/features/files/browser/grid-layout'
import { filesErrorMessage } from '@/features/files/file-display'
import { FileMoveDialog } from '@/features/files/FileMoveDialog'
import { FilePreviewDialog } from '@/features/files/FilePreviewDialog'
import { useFileClipboard } from '@/features/files/browser/clipboard'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { FileDragOverlay } from '@/features/files/browser/FileDragOverlay'
import { FileItem, type FileDropHandlers } from '@/features/files/browser/FileItem'
import {
  clickSelect,
  EMPTY_SELECTION,
  navigateIndex,
  pruneSelection,
  selectAll,
  selectOnly,
  stepSelect,
  typeaheadIndex,
  type FileSelection,
  type NavigationKey,
} from '@/features/files/browser/selection'
import { readFileSort, sortFileNodes, toggleFileSort, uniqueChildName, writeFileSort, type FileSort, type FileSortKey } from '@/features/files/browser/sort'
import { hasPrimaryModifier, isAppleShortcut, isEditableTarget, shortcutLabel } from '@/features/files/browser/shortcuts'
import { useSidePanel, type PanelContent } from '@/features/side-panel/store'
import { AgentMenuItems, SplitViewButton } from '@/features/side-panel/AgentActions'
import { usePublishFilesView, type FilesViewPlace } from '@/features/side-panel/agent'
import { PanelWindowButtons } from '@/features/side-panel/PanelControls'
import { panelContentPath, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { SelectionAction } from '@/features/files/browser/SelectionAction'
import { useFileOperations } from '@/features/files/browser/use-file-operations'
import { useItemDrag } from '@/features/files/browser/use-item-drag'

const VIEW_STORAGE_KEY = 'pulpo.files.view'
const UPLOAD_CONCURRENCY = 3
const TYPEAHEAD_RESET_MS = 800
const NAVIGATION_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

type FilesView = 'list' | 'grid'
interface UploadEntry { id: string; name: string; error?: string }
interface MenuState { point: ContextMenuPoint; scope: 'items' | 'background' }
interface Marquee { left: number; top: number; width: number; height: number }

function readView(): FilesView {
  try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}

function isFileDrag(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

function SortHeader({ label, sortKey, sort, onSort, className }: {
  label: string
  sortKey: FileSortKey
  sort: FileSort
  onSort: (key: FileSortKey) => void
  className?: string
}) {
  const active = sort.key === sortKey
  const Icon = sort.direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('flex min-w-0 cursor-pointer items-center gap-1 rounded text-left hover:text-foreground', active && 'text-foreground', className)}
    >
      <span className="truncate">{label}</span>
      {active && <Icon className="size-3 shrink-0" />}
    </button>
  )
}

/*
 * Which files view keys go to: the one last clicked. Before any click only the page listens,
 * so a browser in the side panel never takes arrow keys meant for a chat beside it.
 */
let lastPointerDown: Element | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (event) => { lastPointerDown = event.target instanceof Element ? event.target : null }, true)
}

function ownsKeys(layout: FilesViewPlace['layout'], root: HTMLElement | null): boolean {
  if (layout === 'panel') return Boolean(root && lastPointerDown && root.contains(lastPointerDown))
  return !lastPointerDown?.closest('[data-side-panel]')
}

export function FilesPage() {
  const { folderId } = useParams()
  return <FilesBrowser folderId={folderId ?? null} layout="page" />
}

/** A folder in the side panel, beside a chat or another view. */
export function FolderPanelView({ folderId }: { folderId: string | null }) {
  return <FilesBrowser folderId={folderId} layout="panel" />
}

function FilesBrowser({ folderId, layout }: { folderId: string | null; layout: FilesViewPlace['layout'] }) {
  const panel = layout === 'panel'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const listing = useQuery({
    queryKey: folderQueryKey(userId, folderId),
    queryFn: () => fetchFolder(folderId),
    enabled: Boolean(userId && filesEnabled),
  })
  const place = useMemo<FilesViewPlace>(() => ({ layout, view: { kind: 'folder', id: folderId } }), [folderId, layout])
  const agentItem = useMemo(() => ({ id: folderId ?? FILE_SCOPE_ROOT }), [folderId])
  usePublishFilesView(place, filesEnabled && !listing.isError ? agentItem : null)
  const ops = useFileOperations()
  const clip = useFileClipboard((state) => state.clip)
  const [view, setView] = useState<FilesView>(readView)
  const [sort, setSort] = useState<FileSort>(readFileSort)
  const [selection, setSelection] = useState<FileSelection>(EMPTY_SELECTION)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [moving, setMoving] = useState<FileNode[] | null>(null)
  const [previewing, setPreviewing] = useState<FileNode | null>(null)
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastPointerType = useRef('mouse')
  const typeahead = useRef({ text: '', at: 0 })

  const nodes = useMemo(() => sortFileNodes(listing.data?.children ?? [], sort), [listing.data, sort])

  // Grid view is a canvas: items keep the places they are dragged to, per folder and synced.
  const layoutKey = folderLayoutQueryKey(userId, folderId)
  const layoutQuery = useQuery({
    queryKey: layoutKey,
    queryFn: () => fetchFolderLayout(folderId),
    enabled: Boolean(userId && filesEnabled && view === 'grid' && !listing.isError),
  })
  const snapToGrid = layoutQuery.data?.snapToGrid ?? true
  const [canvasWidth, setCanvasWidth] = useState(0)
  const widthProbe = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    const observer = new ResizeObserver(() => setCanvasWidth(element.clientWidth))
    observer.observe(element)
    setCanvasWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  const columns = Math.max(1, Math.floor(canvasWidth / GRID_CELL.width))
  const gridPositions = useMemo(
    () => view === 'grid' ? arrangeGrid(nodes.map((node) => node.id), layoutQuery.data?.positions ?? {}, { columns, snap: snapToGrid }) : null,
    [columns, layoutQuery.data, nodes, snapToGrid, view],
  )
  const order = useMemo(() => gridPositions ? readingOrder(gridPositions) : nodes.map((node) => node.id), [gridPositions, nodes])
  const bodyRef = useRef<HTMLDivElement>(null)

  /** Saves layout changes at once here, then on the server (other sessions refetch). */
  const saveLayout = (patch: { snapToGrid?: boolean; positions?: Record<string, FileGridPosition> }) => {
    queryClient.setQueryData<FileFolderLayout>(layoutKey, (current) => ({
      folderId,
      snapToGrid: patch.snapToGrid ?? current?.snapToGrid ?? true,
      positions: { ...current?.positions, ...patch.positions },
    }))
    void updateFolderLayout({ folderId, ...patch }).catch((cause: unknown) => {
      ops.fail(cause)
      void queryClient.invalidateQueries({ queryKey: layoutKey })
    })
  }
  const toggleSnap = () => {
    if (!gridPositions) return
    const snap = !snapToGrid
    // Every current place is saved, so items that were placed automatically stay put.
    const current = Object.fromEntries(gridPositions)
    saveLayout({ snapToGrid: snap, positions: snap ? Object.fromEntries(arrangeGrid(order, current, { columns, snap: true })) : current })
  }
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selectedNodes = nodes.filter((node) => selection.ids.has(node.id))
  const trail = [...(listing.data?.ancestors ?? []), ...(listing.data?.folder ? [listing.data.folder] : [])]
  const cutIds = new Set(clip?.mode === 'cut' ? clip.nodes.map((node) => node.id) : [])

  useEffect(() => {
    setSelection(EMPTY_SELECTION)
    setRenamingId(null)
  }, [folderId])
  useEffect(() => setSelection((current) => pruneSelection(current, order)), [order])

  const changeView = (next: FilesView) => {
    setView(next)
    try { localStorage.setItem(VIEW_STORAGE_KEY, next) } catch { /* the preference is optional */ }
  }

  const changeSort = (key: FileSortKey) => {
    const next = toggleFileSort(sort, key)
    setSort(next)
    writeFileSort(next)
  }

  const goMain = useMainNavigate()
  /**
   * Shows a folder or file in the other view: the panel when browsing on the page, the main view
   * when browsing in the panel. Alt/Option-click, and "Open to the side" or "Open in main view".
   */
  const openElsewhere = (content: PanelContent) => {
    // From the panel it becomes the only view, as with the header's maximize button.
    if (panel) {
      useSidePanel.getState().close()
      goMain(panelContentPath(content))
    } else {
      useSidePanel.getState().open(content)
    }
  }
  const nodeContent = (node: FileNode): PanelContent => node.kind === 'folder' ? { kind: 'folder', id: node.id } : { kind: 'file', id: node.id }
  const elsewhereLabel = panel ? ui("Open in main view") : ui("Open to the side")
  const ElsewhereIcon = panel ? Maximize2 : PanelRight
  const elsewhereShortcut = isAppleShortcut() ? '⌥ Click' : 'Alt+Click'

  /** Shows a folder here: the page follows the route, the panel keeps its own place. */
  const showFolder = (id: string | null) => {
    if (panel) useSidePanel.getState().open({ kind: 'folder', id })
    else navigate(id ? `/files/f/${id}` : '/files')
  }

  const open = (node: FileNode) => {
    if (node.kind === 'folder') showFolder(node.id)
    // The panel shows every file in place, with a way back to its folder.
    else if (panel) useSidePanel.getState().open({ kind: 'file', id: node.id })
    // Markdown opens in the editor view: editable documents directly, uploads as a preview with Edit.
    else if (node.kind === 'doc' || isMarkdownName(node.name)) navigate(`/files/d/${node.id}`)
    else setPreviewing(node)
  }

  /** Adds a freshly created node to the cached listing so it can be renamed immediately. */
  const insertIntoListing = (node: FileNode) => {
    queryClient.setQueryData<FileListing>(folderQueryKey(userId, folderId), (current) => current && { ...current, children: [...current.children, node] })
  }

  const newFolder = async () => {
    try {
      const node = await createFolder(folderId, uniqueChildName(ui("Untitled folder"), nodes))
      insertIntoListing(node)
      setSelection(selectOnly(node.id))
      setRenamingId(node.id)
    } catch (cause) {
      ops.fail(cause)
    }
  }

  /** Creates a Markdown file and starts renaming it in place, like a desktop file manager. */
  const newFile = async () => {
    try {
      const node = await createDoc(folderId, uniqueChildName(`${ui("Untitled")}.md`, nodes))
      insertIntoListing(node)
      setSelection(selectOnly(node.id))
      setRenamingId(node.id)
    } catch (cause) {
      ops.fail(cause)
    }
  }

  const upload = async (files: File[], parentId: string | null = folderId) => {
    if (!files.length) return
    const queue = files.map((file) => ({ file, entry: { id: crypto.randomUUID(), name: file.name } }))
    setUploads((current) => [...current, ...queue.map((item) => item.entry)])
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { file, entry } = item
        try {
          await uploadFile(parentId, file)
          setUploads((current) => current.filter((candidate) => candidate.id !== entry.id))
        } catch (cause) {
          const error = filesErrorMessage(cause, file.name)
          setUploads((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, error } : candidate))
        }
        await ops.refresh()
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker))
  }

  const trashSelection = async (targets = selectedNodes) => {
    if (!targets.length) return
    setSelection(EMPTY_SELECTION)
    await ops.trash(targets)
  }

  const setClipboard = (mode: 'cut' | 'copy', targets = selectedNodes) => {
    if (!targets.length) return
    useFileClipboard.setState({ clip: { mode, nodes: targets } })
    if (mode === 'copy') {
      ops.notify(targets.length === 1 ? uit`Copied "${targets[0]!.name}"` : uit`Copied ${targets.length} items`)
    }
  }

  const paste = async () => {
    const current = useFileClipboard.getState().clip
    if (!current) return
    if (current.mode === 'cut') {
      useFileClipboard.setState({ clip: null })
      await ops.move(current.nodes, folderId)
    } else {
      const created = await ops.copy(current.nodes, folderId)
      if (created?.length) setSelection({ ids: new Set(created.map((node) => node.id)), anchor: created[0]!.id, focus: created.at(-1)!.id })
    }
  }

  const duplicate = async (targets = selectedNodes) => {
    const created = await ops.copy(targets, folderId, 'duplicate')
    if (created?.length) setSelection({ ids: new Set(created.map((node) => node.id)), anchor: created[0]!.id, focus: created.at(-1)!.id })
  }

  const startRename = () => {
    const target = selection.focus && selection.ids.has(selection.focus) ? byId.get(selection.focus) : selectedNodes[0]
    if (target && selectedNodes.length === 1) setRenamingId(target.id)
  }

  const gridColumns = () => {
    if (view !== 'grid') return 1
    const items = itemsRef.current?.querySelectorAll<HTMLElement>('[data-file-id]')
    if (!items?.length) return 1
    const top = items[0]!.offsetTop
    let columns = 0
    for (const item of items) {
      if (item.offsetTop !== top) break
      columns += 1
    }
    return Math.max(1, columns)
  }

  const focusItem = (id: string) => {
    setKeyboardFocus(true)
    itemsRef.current?.querySelector<HTMLElement>(`[data-file-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // One window listener that always sees the latest state, like a desktop file manager.
  const handleKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditableTarget(event.target) || renamingId || moving || previewing || menu) return
    if (!ownsKeys(layout, rootRef.current)) return
    const mod = hasPrimaryModifier(event)
    const key = event.key
    if (NAVIGATION_KEYS.has(key) && !mod) {
      event.preventDefault()
      const current = selection.focus ? order.indexOf(selection.focus) : -1
      const next = navigateIndex(current, order.length, key as NavigationKey, gridColumns())
      if (next < 0) return
      setSelection(stepSelect(selection, order, order[next]!, event.shiftKey))
      focusItem(order[next]!)
      return
    }
    if (mod && key.toLowerCase() === 'a') { event.preventDefault(); setSelection(selectAll(order)); return }
    if (mod && key.toLowerCase() === 'x') { event.preventDefault(); setClipboard('cut'); return }
    if (mod && key.toLowerCase() === 'c') { event.preventDefault(); setClipboard('copy'); return }
    if (mod && key.toLowerCase() === 'v') { event.preventDefault(); void paste(); return }
    if (mod && key.toLowerCase() === 'd') { event.preventDefault(); void duplicate(); return }
    if (mod && event.shiftKey && key.toLowerCase() === 'n') { event.preventDefault(); void newFolder(); return }
    if (mod) return
    if (key === 'Enter') {
      const target = selection.focus ? byId.get(selection.focus) : selectedNodes[0]
      if (target) { event.preventDefault(); open(target) }
      return
    }
    if (key === 'F2') { event.preventDefault(); startRename(); return }
    if (key === 'Delete' || key === 'Backspace') {
      if (selectedNodes.length) { event.preventDefault(); void trashSelection() }
      return
    }
    if (key === ' ') {
      const target = selection.focus ? byId.get(selection.focus) : selectedNodes[0]
      if (target) { event.preventDefault(); open(target) }
      return
    }
    if (key === 'Escape') {
      if (clip?.mode === 'cut') useFileClipboard.setState({ clip: null })
      setSelection(EMPTY_SELECTION)
      return
    }
    if (key.length === 1 && !event.altKey && /\S/.test(key)) {
      const now = Date.now()
      typeahead.current = { text: now - typeahead.current.at > TYPEAHEAD_RESET_MS ? key : typeahead.current.text + key, at: now }
      const current = selection.focus ? order.indexOf(selection.focus) : -1
      const index = typeaheadIndex(nodes.map((node) => node.name), typeahead.current.text, current)
      if (index >= 0) {
        setSelection(selectOnly(order[index]!))
        focusItem(order[index]!)
      }
    }
  }
  const handleKeyRef = useRef(handleKey)
  handleKeyRef.current = handleKey
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  /** Rubber-band selection from empty space; Cmd/Ctrl or Shift adds to the current selection. */
  const startMarquee = (event: PointerEvent) => {
    // Menus and dialogs render in portals; React still bubbles their events up to here.
    if (!event.currentTarget.contains(event.target as Node)) return
    if (event.button !== 0 || event.pointerType !== 'mouse') return
    if ((event.target as Element).closest('[data-file-id], button, a, input, [role="toolbar"], [data-slot="scroll-area-scrollbar"]')) return
    const additive = hasPrimaryModifier(event) || event.shiftKey
    const base = additive ? new Set(selection.ids) : new Set<string>()
    const startX = event.clientX
    const startY = event.clientY
    let moved = false
    setKeyboardFocus(false)
    const update = (moveEvent: globalThis.PointerEvent) => {
      const left = Math.min(startX, moveEvent.clientX)
      const top = Math.min(startY, moveEvent.clientY)
      const width = Math.abs(moveEvent.clientX - startX)
      const height = Math.abs(moveEvent.clientY - startY)
      if (!moved && width < 4 && height < 4) return
      moved = true
      setMarquee({ left, top, width, height })
      const hits = new Set(base)
      for (const element of itemsRef.current?.querySelectorAll<HTMLElement>('[data-file-id]') ?? []) {
        const rect = element.getBoundingClientRect()
        if (rect.left < left + width && rect.right > left && rect.top < top + height && rect.bottom > top) hits.add(element.dataset.fileId!)
      }
      const ids = order.filter((id) => hits.has(id))
      setSelection({ ids: new Set(ids), anchor: ids[0] ?? null, focus: ids.at(-1) ?? null })
    }
    const finish = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
      setMarquee(null)
      if (!moved && !additive) setSelection(EMPTY_SELECTION)
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish)
  }

  const openMenuAt = (point: ContextMenuPoint, node: FileNode | null) => {
    if (node && !selection.ids.has(node.id)) setSelection(selectOnly(node.id))
    if (!node) setSelection(EMPTY_SELECTION)
    setMenu({ point, scope: node ? 'items' : 'background' })
  }

  const drag = useItemDrag({
    tile: view === 'grid',
    canvas: view === 'grid' ? {
      // The whole scrolling area below the header, including empty space past the items.
      element: () => bodyRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null,
      onMove: (dragged, delta) => {
        if (!gridPositions) return
        saveLayout({ positions: Object.fromEntries(moveInGrid(gridPositions, dragged.map((node) => node.id), delta, snapToGrid)) })
      },
    } : undefined,
    resolveNodes: (node) => {
      if (selection.ids.has(node.id)) return nodes.filter((item) => selection.ids.has(item.id))
      setSelection(selectOnly(node.id))
      return [node]
    },
    // Dropping into the folder the items already live in, or into one of them, does nothing.
    canDrop: (targetId, dragged) => !dragged.some((node) => node.id === targetId) && !dragged.every((node) => node.parentId === targetId),
    onDrop: (dragged, targetId) => { void ops.move(dragged, targetId) },
  })

  /** Folder rows and breadcrumbs accept files dropped in from the operating system. */
  const dropProps = (targetId: string | null, key = targetId ?? 'root'): FileDropHandlers => ({
    onDragOver: (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      setDropTarget(key)
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === key ? null : current)
    },
    onDrop: (event) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      void upload([...event.dataTransfer.files], targetId)
    },
  })

  const pageDrop = {
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      setDropTarget('page')
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
    },
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      setDropTarget(null)
      void upload([...event.dataTransfer.files])
    },
  }

  const itemHandlers = (node: FileNode) => ({
    onPointerDown: (event: PointerEvent) => {
      lastPointerType.current = event.pointerType
      setKeyboardFocus(false)
      if (renamingId !== node.id) drag.onPointerDown(event, node)
    },
    onClick: (event: MouseEvent) => {
      if (renamingId === node.id || drag.consumeClick()) return
      // Touch has no double-click or hover, so a tap opens, as in mobile file browsers.
      if (lastPointerType.current === 'touch') { open(node); return }
      // Alt/Option-click opens an item in the other view, like "Open to the side" in editors.
      if (event.altKey) {
        setSelection(selectOnly(node.id))
        openElsewhere(nodeContent(node))
        return
      }
      setSelection(clickSelect(selection, order, node.id, { toggle: hasPrimaryModifier(event), range: event.shiftKey }))
    },
    onDoubleClick: () => { if (renamingId !== node.id) open(node) },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      openMenuAt({ x: event.clientX, y: event.clientY }, node)
    },
    onMenuButton: (event: MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      openMenuAt({ x: rect.left, y: rect.bottom }, node)
    },
    dropHandlers: node.kind === 'folder' ? dropProps(node.id) : undefined,
    onRenameCommit: async (name: string) => {
      const ok = await ops.rename(node, name)
      if (ok) setRenamingId(null)
      return ok
    },
    onRenameCancel: () => setRenamingId(null),
  })

  if (!filesEnabled) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-xl border p-6 text-center">
          <TriangleAlert className="mx-auto size-8 text-amber-500" />
          <h1 className="mt-3 text-lg font-semibold">{ui("Files are disabled")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{ui("The administrator has turned off Files. Stored files are kept and return if Files is re-enabled.")}</p>
        </div>
      </div>
    )
  }

  const single = selectedNodes.length === 1 ? selectedNodes[0]! : null
  const canDownload = selectedNodes.length > 0 && selectedNodes.every((node) => node.kind !== 'folder')
  const canUseAgent = selectedNodes.length > 0 && selectedNodes.length <= MAX_CHAT_FILE_SCOPES
  const itemMenu = (
    <>
      {selectedNodes.length > 1 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{uit`${selectedNodes.length} items selected`}</DropdownMenuLabel>}
      {single && (
        <DropdownMenuItem onSelect={() => open(single)}>
          <Eye /> {single.kind === 'blob' ? ui("Preview") : ui("Open")}
          <DropdownMenuShortcut>{single.kind === 'blob' ? ui("Space") : '↵'}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {single && (
        <DropdownMenuItem onSelect={() => openElsewhere(nodeContent(single))}>
          <ElsewhereIcon /> {elsewhereLabel}<DropdownMenuShortcut>{elsewhereShortcut}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {canUseAgent && <AgentMenuItems ids={selectedNodes.map((node) => node.id)} place={place} />}
      {canDownload && (
        <DropdownMenuItem onSelect={() => void ops.download(selectedNodes)}>
          <Download /> {ui("Download")}
        </DropdownMenuItem>
      )}
      {single && <DropdownMenuItem onSelect={() => setRenamingId(single.id)}><Pencil /> {ui("Rename")}<DropdownMenuShortcut>{shortcutLabel('F2')}</DropdownMenuShortcut></DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => setMoving(selectedNodes)}><FolderInput /> {ui("Move to…")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void duplicate()}><CopyPlus /> {ui("Duplicate")}<DropdownMenuShortcut>{shortcutLabel('D', { mod: true })}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setClipboard('cut')}><Scissors /> {ui("Cut")}<DropdownMenuShortcut>{shortcutLabel('X', { mod: true })}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setClipboard('copy')}><Copy /> {ui("Copy")}<DropdownMenuShortcut>{shortcutLabel('C', { mod: true })}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => void trashSelection()}><Trash2 /> {ui("Move to trash")}<DropdownMenuShortcut>⌫</DropdownMenuShortcut></DropdownMenuItem>
    </>
  )
  const backgroundMenu = (
    <>
      <DropdownMenuItem onSelect={() => void newFile()}><FilePlus2 /> {ui("New file")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void newFolder()}><FolderPlus /> {ui("New folder")}<DropdownMenuShortcut>{shortcutLabel('N', { mod: true, shift: true })}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => fileInput.current?.click()}><Upload /> {ui("Upload files")}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!clip} onSelect={() => void paste()}>
        <ClipboardPaste /> {clip ? (clip.nodes.length === 1 ? uit`Paste "${clip.nodes[0]!.name}"` : uit`Paste ${clip.nodes.length} items`) : ui("Paste")}
        <DropdownMenuShortcut>{shortcutLabel('V', { mod: true })}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!nodes.length} onSelect={() => setSelection(selectAll(order))}>
        <SquareDashedMousePointer /> {ui("Select all")}<DropdownMenuShortcut>{shortcutLabel('A', { mod: true })}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  )

  let body: ReactNode
  if (listing.isPending) {
    body = <div className="grid h-48 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  } else if (listing.isError) {
    body = (
      <div className="rounded-xl border p-8 text-center text-sm">
        <p className="text-muted-foreground">{filesErrorMessage(listing.error)}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => showFolder(null)}>{ui("Back to My files")}</Button>
      </div>
    )
  } else if (!nodes.length) {
    body = (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Upload className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{ui("This folder is empty")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ui("Drop files here, or right-click to create a file or folder.")}</p>
      </div>
    )
  } else {
    const shown = gridPositions ? order.map((id) => byId.get(id)!).filter(Boolean) : nodes
    const items = shown.map((node) => (
      <FileItem
        key={node.id}
        node={node}
        view={view}
        position={gridPositions?.get(node.id)}
        selected={selection.ids.has(node.id)}
        focused={keyboardFocus && selection.focus === node.id}
        cut={cutIds.has(node.id)}
        dragging={drag.draggingIds.has(node.id)}
        dropActive={dropTarget === node.id || drag.activeTarget === node.id}
        renaming={renamingId === node.id}
        {...itemHandlers(node)}
      />
    ))
    let width = 0, height = 0
    for (const place of gridPositions?.values() ?? []) {
      width = Math.max(width, place.x + GRID_CELL.width)
      height = Math.max(height, place.y + GRID_CELL.height)
    }
    body = view === 'grid' ? (
      // One spare cell past the last item leaves room to drag things further out.
      <div
        ref={itemsRef}
        role="listbox"
        aria-multiselectable
        aria-label={ui("Files")}
        className="relative"
        style={{ width: Math.max(canvasWidth, width + GRID_CELL.width), height: height + GRID_CELL.height }}
      >
        {items}
      </div>
    ) : (
      <div className="@container overflow-hidden rounded-xl border">
        <div className="hidden gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground @lg:grid @lg:grid-cols-[minmax(0,1fr)_6rem_2.5rem] @2xl:grid-cols-[minmax(0,1fr)_9rem_6.5rem_6rem_2.5rem]">
          <SortHeader label={ui("Name")} sortKey="name" sort={sort} onSort={changeSort} />
          <SortHeader label={ui("Modified")} sortKey="modified" sort={sort} onSort={changeSort} className="hidden @2xl:flex" />
          <SortHeader label={ui("Kind")} sortKey="kind" sort={sort} onSort={changeSort} className="hidden @2xl:flex" />
          <SortHeader label={ui("Size")} sortKey="size" sort={sort} onSort={changeSort} className="justify-end" />
          <span />
        </div>
        <div ref={itemsRef} role="listbox" aria-multiselectable aria-label={ui("Files")} className="divide-y">{items}</div>
      </div>
    )
  }


  const crumb = (id: string | null, key: string, isCurrent: boolean, content: ReactNode, className: string) => (
    <Link
      to={id ? `/files/f/${id}` : '/files'}
      {...dropProps(id, key)}
      data-drop-target={id ?? 'root'}
      draggable={false}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        if (event.altKey) { event.preventDefault(); openElsewhere({ kind: 'folder', id }); return }
        // In the panel the path moves the panel, not the page; the link still opens new tabs.
        if (panel) { event.preventDefault(); showFolder(id) }
      }}
      className={cn(className, (dropTarget === key || drag.activeTarget === (id ?? 'root')) && 'bg-sky-500/20 text-foreground')}
    >
      {content}
    </Link>
  )
  const path = (
    <nav aria-label={ui("Folder path")} className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      {crumb(null, 'root', false, <><HardDrive className="size-3" />{ui("My files")}</>, 'flex shrink-0 items-center gap-1 rounded px-1 hover:bg-accent hover:text-foreground')}
      {trail.map((folder, index) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="size-3 shrink-0" />
          {crumb(folder.id, `crumb:${folder.id}`, index === trail.length - 1, folder.name, cn(
            'truncate rounded px-1 hover:bg-accent hover:text-foreground',
            index === trail.length - 1 && 'font-medium text-foreground',
          ))}
        </span>
      ))}
    </nav>
  )
  const selectionBar = selectedNodes.length > 0 && (
    <TooltipProvider delayDuration={250}>
      <div role="toolbar" aria-label={ui("Selection")} className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border bg-muted px-0.5">
        <SelectionAction label={ui("Clear selection")} onClick={() => setSelection(EMPTY_SELECTION)}><X /></SelectionAction>
        <span className="px-1.5 text-sm font-medium whitespace-nowrap tabular-nums">{selectedNodes.length === 1 ? ui("1 selected") : uit`${selectedNodes.length} selected`}</span>
        {canDownload && <SelectionAction label={ui("Download")} onClick={() => void ops.download(selectedNodes)}><Download /></SelectionAction>}
        <SelectionAction label={ui("Move to…")} onClick={() => setMoving(selectedNodes)}><FolderInput /></SelectionAction>
        <SelectionAction label={ui("Duplicate")} onClick={() => void duplicate()}><CopyPlus /></SelectionAction>
        <SelectionAction label={ui("Move to trash")} destructive onClick={() => void trashSelection()}><Trash2 /></SelectionAction>
      </div>
    </TooltipProvider>
  )
  const newMenu = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={listing.isError} aria-label={ui("New")}><Plus /></Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{ui("New")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">{backgroundMenu}</DropdownMenuContent>
    </DropdownMenu>
  )
  const fileInputElement = (
    <input
      ref={fileInput}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        void upload([...(event.target.files ?? [])])
        event.target.value = ''
      }}
    />
  )
  // Handlers sit on the scroll area so the empty space below the list also clears the
  // selection, starts a drag-select, opens the folder menu, and accepts dropped files.
  const scrollHandlers = {
    ...pageDrop,
    onPointerDown: startMarquee,
    onContextMenu: (event: MouseEvent) => {
      if (!event.currentTarget.contains(event.target as Node)) return
      if ((event.target as Element).closest('[data-file-id], input, a, [data-slot="scroll-area-scrollbar"]')) return
      event.preventDefault()
      if (!listing.isError) openMenuAt({ x: event.clientX, y: event.clientY }, null)
    },
  }
  const dropHighlight = dropTarget === 'page' && 'rounded-2xl bg-primary/5 outline-2 -outline-offset-8 outline-dashed outline-primary/40'
  const overlays = (
    <>
      {marquee && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-sm border border-sky-500/70 bg-sky-500/15"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}

      {uploads.length > 0 && (
        <div className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-2 shadow-lg" aria-live="polite">
          <div className="flex items-center justify-between px-2 py-1 text-sm font-medium">
            <span>{ui("Uploads")}</span>
            <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={ui("Dismiss")} onClick={() => setUploads((current) => current.filter((entry) => !entry.error))}>
              <X className="size-4" />
            </button>
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {uploads.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                {entry.error ? <TriangleAlert className="size-4 shrink-0 text-destructive" /> : <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.name}</span>
                  {entry.error && <span className="block text-xs text-destructive">{entry.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FileContextMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menu?.scope === 'items' ? itemMenu : (
          <>
            {backgroundMenu}
            <DropdownMenuSeparator />
            {view === 'grid' && (
              <DropdownMenuCheckboxItem checked={snapToGrid} onCheckedChange={toggleSnap} onSelect={(event: Event) => event.preventDefault()}>
                {ui("Snap to grid")}
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuItem onSelect={() => openElsewhere(place.view)}><ElsewhereIcon /> {elsewhereLabel}</DropdownMenuItem>
            <AgentMenuItems ids={[folderId ?? FILE_SCOPE_ROOT]} place={place} />
          </>
        )}
      </FileContextMenu>
      <FileMoveDialog nodes={moving} onOpenChange={(open) => { if (!open) setMoving(null) }} onMove={(targets, parentId) => ops.move(targets, parentId)} />
      <FilePreviewDialog
        node={previewing}
        onOpenChange={(open) => { if (!open) setPreviewing(null) }}
        onDownload={(node) => void downloadFile(node).catch(ops.fail)}
      />
      <FileDragOverlay drag={drag} />
    </>
  )

  const iconTip = (label: string, control: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
  const toolbar = (
    <>
      <div role="group" aria-label={ui("View")} className="flex">
        {iconTip(ui("List view"), <Button variant="ghost" size="icon-sm" aria-pressed={view === 'list'} aria-label={ui("List view")} className={cn(view === 'list' && 'bg-accent text-foreground')} onClick={() => changeView('list')}><List /></Button>)}
        {iconTip(ui("Grid view"), <Button variant="ghost" size="icon-sm" aria-pressed={view === 'grid'} aria-label={ui("Grid view")} className={cn(view === 'grid' && 'bg-accent text-foreground')} onClick={() => changeView('grid')}><LayoutGrid /></Button>)}
      </div>
      {iconTip(ui("Trash"), <Button asChild variant="ghost" size="icon-sm" aria-label={ui("Trash")}><Link to="/files/trash"><Trash2 /></Link></Button>)}
      {newMenu}
    </>
  )

  // The page and the panel share one layout; only the window controls at the end differ.
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <header className={cn(
        '@container flex min-w-0 items-center gap-1 border-b',
        panel ? 'side-panel-header px-3 py-1.5' : 'mobile-page-content px-4 py-1.5 sm:px-6',
      )}>
        <div className="min-w-0 flex-1 pr-1">
          {path}
          <h1 className="truncate text-base leading-7 font-semibold">{listing.data?.folder?.name ?? ui("My files")}</h1>
        </div>
        {selectionBar}
        {/* With room the controls stay beside the selection bar; in a narrow header the bar takes their place. */}
        <div className={cn('flex shrink-0 items-center gap-0.5', selectedNodes.length > 0 && '@max-[40rem]:hidden')}>{toolbar}</div>
        {panel ? <PanelWindowButtons content={place.view} /> : <SplitViewButton view={place.view} />}
        {fileInputElement}
      </header>
      <ScrollArea className="min-h-0 flex-1" horizontal={view === 'grid'} {...scrollHandlers}>
        <div ref={bodyRef} className={cn('min-h-full', panel ? 'px-3 py-3' : 'mobile-page-content mx-auto max-w-6xl px-4 py-4 sm:px-6', dropHighlight, marquee && 'select-none')}>
          <div ref={widthProbe} aria-hidden className="h-0 w-full" />
          {body}
        </div>
        {overlays}
      </ScrollArea>
    </div>
  )
}
