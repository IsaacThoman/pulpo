import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileListing, FileNode } from '@pulpo/contracts'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FilePlus2,
  FileUp,
  FolderInput,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { createDoc, createFolder, downloadFile, fetchFolder, folderQueryKey, uploadFile } from '@/features/files/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { FileMoveDialog } from '@/features/files/FileMoveDialog'
import { FilePreviewDialog } from '@/features/files/FilePreviewDialog'
import { useFileClipboard } from '@/features/files/browser/clipboard'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { FileItem, type FileDropHandlers } from '@/features/files/browser/FileItem'
import { FileToasts } from '@/features/files/browser/FileToasts'
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
import { hasPrimaryModifier, isEditableTarget, shortcutLabel } from '@/features/files/browser/shortcuts'
import { useFileOperations } from '@/features/files/browser/use-file-operations'

/** Drag payload for moving existing items (a JSON id list); external drops carry "Files" instead. */
const NODE_DRAG_TYPE = 'application/x-pulpo-file-nodes'
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

function isNodeDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(NODE_DRAG_TYPE)
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

export function FilesPage() {
  const { folderId: routeFolderId } = useParams()
  const folderId = routeFolderId ?? null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const listing = useQuery({
    queryKey: folderQueryKey(userId, folderId),
    queryFn: () => fetchFolder(folderId),
    enabled: Boolean(userId && filesEnabled),
  })
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
  const markdownInput = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)
  const draggingIds = useRef<string[]>([])
  const lastPointerType = useRef('mouse')
  const typeahead = useRef({ text: '', at: 0 })

  const nodes = useMemo(() => sortFileNodes(listing.data?.children ?? [], sort), [listing.data, sort])
  const order = useMemo(() => nodes.map((node) => node.id), [nodes])
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

  const open = (node: FileNode) => {
    if (node.kind === 'folder') navigate(`/files/f/${node.id}`)
    else if (node.kind === 'doc') navigate(`/files/d/${node.id}`)
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

  const newDocument = async () => {
    try {
      const node = await createDoc(folderId, ui("Untitled document"))
      await ops.refresh()
      navigate(`/files/d/${node.id}`)
    } catch (cause) {
      ops.fail(cause)
    }
  }

  /** Markdown files become editable documents; the file name without its extension becomes the title. */
  const importMarkdown = async (files: File[]) => {
    for (const file of files) {
      try {
        await createDoc(folderId, file.name.replace(/\.(md|markdown|txt)$/i, '') || ui("Untitled document"), await file.text())
      } catch (cause) {
        ops.fail(cause)
      }
    }
    await ops.refresh()
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

  /** Folder rows and breadcrumbs accept both uploads and moves. */
  const dropProps = (targetId: string | null, key = targetId ?? 'root'): FileDropHandlers => ({
    onDragOver: (event) => {
      if (!isFileDrag(event) && !isNodeDrag(event)) return
      if (targetId && draggingIds.current.includes(targetId)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = isNodeDrag(event) ? 'move' : 'copy'
      setDropTarget(key)
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === key ? null : current)
    },
    onDrop: (event) => {
      if (!isFileDrag(event) && !isNodeDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      const payload = event.dataTransfer.getData(NODE_DRAG_TYPE)
      if (payload) {
        const ids = JSON.parse(payload) as string[]
        void ops.move(ids.map((id) => byId.get(id)).filter((node): node is FileNode => Boolean(node)), targetId)
      } else {
        void upload([...event.dataTransfer.files], targetId)
      }
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
    },
    onClick: (event: MouseEvent) => {
      if (renamingId === node.id) return
      // Touch has no double-click or hover, so a tap opens, as in mobile file browsers.
      if (lastPointerType.current === 'touch') { open(node); return }
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
    onDragStart: (event: DragEvent) => {
      const ids = selection.ids.has(node.id) ? order.filter((id) => selection.ids.has(id)) : [node.id]
      if (!selection.ids.has(node.id)) setSelection(selectOnly(node.id))
      draggingIds.current = ids
      event.dataTransfer.setData(NODE_DRAG_TYPE, JSON.stringify(ids))
      event.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => { draggingIds.current = [] },
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
  const itemMenu = (
    <>
      {selectedNodes.length > 1 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{uit`${selectedNodes.length} items selected`}</DropdownMenuLabel>}
      {single && (
        <DropdownMenuItem onSelect={() => open(single)}>
          <Eye /> {single.kind === 'blob' ? ui("Preview") : ui("Open")}
          <DropdownMenuShortcut>{single.kind === 'blob' ? ui("Space") : '↵'}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {canDownload && (
        <DropdownMenuItem onSelect={() => void ops.download(selectedNodes)}>
          <Download /> {single?.kind === 'doc' ? ui("Download as Markdown") : ui("Download")}
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
      <DropdownMenuItem onSelect={() => void newDocument()}><FilePlus2 /> {ui("New document")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void newFolder()}><FolderPlus /> {ui("New folder")}<DropdownMenuShortcut>{shortcutLabel('N', { mod: true, shift: true })}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => fileInput.current?.click()}><Upload /> {ui("Upload files")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => markdownInput.current?.click()}><FileUp /> {ui("Import Markdown as document")}</DropdownMenuItem>
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
        <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/files">{ui("Back to My files")}</Link></Button>
      </div>
    )
  } else if (!nodes.length) {
    body = (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Upload className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{ui("This folder is empty")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ui("Drop files here, or right-click to create a document or folder.")}</p>
      </div>
    )
  } else {
    const items = nodes.map((node) => (
      <FileItem
        key={node.id}
        node={node}
        view={view}
        selected={selection.ids.has(node.id)}
        focused={keyboardFocus && selection.focus === node.id}
        cut={cutIds.has(node.id)}
        dropActive={dropTarget === node.id}
        renaming={renamingId === node.id}
        {...itemHandlers(node)}
      />
    ))
    body = view === 'grid' ? (
      <div ref={itemsRef} role="listbox" aria-multiselectable aria-label={ui("Files")} className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {items}
      </div>
    ) : (
      <div className="overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_6.5rem_6rem_2.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <SortHeader label={ui("Name")} sortKey="name" sort={sort} onSort={changeSort} />
          <SortHeader label={ui("Modified")} sortKey="modified" sort={sort} onSort={changeSort} />
          <SortHeader label={ui("Kind")} sortKey="kind" sort={sort} onSort={changeSort} />
          <SortHeader label={ui("Size")} sortKey="size" sort={sort} onSort={changeSort} className="justify-end" />
          <span />
        </div>
        <div ref={itemsRef} role="listbox" aria-multiselectable aria-label={ui("Files")} className="divide-y">{items}</div>
      </div>
    )
  }

  const sortLabels: Record<FileSortKey, string> = { name: ui("Name"), modified: ui("Modified"), kind: ui("Kind"), size: ui("Size") }

  return (
    // Handlers sit on the scroll area so the empty space below the list also clears the
    // selection, starts a drag-select, opens the folder menu, and accepts dropped files.
    <ScrollArea
      className="h-full"
      {...pageDrop}
      onPointerDown={startMarquee}
      onContextMenu={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return
        if ((event.target as Element).closest('[data-file-id], input, a, [data-slot="scroll-area-scrollbar"]')) return
        event.preventDefault()
        if (!listing.isError) openMenuAt({ x: event.clientX, y: event.clientY }, null)
      }}
    >
      <div
        className={cn(
          'mobile-page-content mx-auto min-h-full max-w-6xl space-y-4 px-6 py-8',
          dropTarget === 'page' && 'rounded-2xl bg-primary/5 outline-2 -outline-offset-8 outline-dashed outline-primary/40',
          marquee && 'select-none',
        )}
      >
        <div className="@container flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{ui("Files")}</h1>
            <nav aria-label={ui("Folder path")} className="mt-1 flex min-w-0 flex-wrap items-center gap-0.5 text-sm text-muted-foreground">
              <Link
                to="/files"
                {...dropProps(null)}
                className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground', dropTarget === 'root' && 'bg-primary/10 text-foreground')}
              >
                <HardDrive className="size-3.5" />{ui("My files")}
              </Link>
              {trail.map((folder, index) => (
                <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight className="size-3.5 shrink-0" />
                  <Link
                    to={`/files/f/${folder.id}`}
                    {...dropProps(folder.id, `crumb:${folder.id}`)}
                    aria-current={index === trail.length - 1 ? 'page' : undefined}
                    className={cn(
                      'max-w-48 truncate rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground',
                      index === trail.length - 1 && 'font-medium text-foreground',
                      dropTarget === `crumb:${folder.id}` && 'bg-primary/10',
                    )}
                  >
                    {folder.name}
                  </Link>
                </span>
              ))}
            </nav>
          </div>
          {/* With room, the selection bar floats over the empty space left of the controls so the title and
              list never move; in a narrow header it takes the controls' place instead of wrapping. */}
          <div className="relative flex min-h-8 items-center gap-2">
            {selectedNodes.length > 0 && (
              <div role="toolbar" aria-label={ui("Selection")} className={cn(
                'flex h-8 items-center gap-0.5 rounded-lg border bg-muted px-0.5',
                // Grid view has an extra Sort button, so it needs a wider header to fit both.
                view === 'grid'
                  ? '@min-[42rem]:absolute @min-[42rem]:top-0 @min-[42rem]:right-full @min-[42rem]:mr-2'
                  : '@min-[36rem]:absolute @min-[36rem]:top-0 @min-[36rem]:right-full @min-[36rem]:mr-2',
              )}>
                <button type="button" aria-label={ui("Clear selection")} title={ui("Clear selection")} onClick={() => setSelection(EMPTY_SELECTION)} className="grid size-6.5 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground">
                  <X className="size-4" />
                </button>
                <span className="px-1.5 text-sm font-medium whitespace-nowrap tabular-nums">{selectedNodes.length === 1 ? ui("1 selected") : uit`${selectedNodes.length} selected`}</span>
                {canDownload && <Button variant="ghost" size="sm" className="h-6.5" aria-label={ui("Download")} title={ui("Download")} onClick={() => void ops.download(selectedNodes)}><Download /> <span className="hidden xl:inline">{ui("Download")}</span></Button>}
                <Button variant="ghost" size="sm" className="h-6.5" aria-label={ui("Move to…")} title={ui("Move to…")} onClick={() => setMoving(selectedNodes)}><FolderInput /> <span className="hidden xl:inline">{ui("Move to…")}</span></Button>
                <Button variant="ghost" size="sm" className="h-6.5" aria-label={ui("Duplicate")} title={ui("Duplicate")} onClick={() => void duplicate()}><CopyPlus /> <span className="hidden xl:inline">{ui("Duplicate")}</span></Button>
                <Button variant="ghost" size="sm" className="h-6.5 text-destructive hover:text-destructive" aria-label={ui("Move to trash")} title={ui("Move to trash")} onClick={() => void trashSelection()}><Trash2 /> <span className="hidden xl:inline">{ui("Move to trash")}</span></Button>
              </div>
            )}
            <div className={cn('flex items-center gap-2', selectedNodes.length > 0 && (view === 'grid' ? '@max-[42rem]:hidden' : '@max-[36rem]:hidden'))}>
              {view === 'grid' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label={ui("Sort")}><ArrowUpDown /> {sortLabels[sort.key]}</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(sortLabels) as FileSortKey[]).map((key) => (
                    <DropdownMenuItem key={key} onSelect={() => changeSort(key)}>
                      {sortLabels[key]}
                      {sort.key === key && <DropdownMenuShortcut>{sort.direction === 'asc' ? '↑' : '↓'}</DropdownMenuShortcut>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              )}
              <div className="flex rounded-lg border p-0.5" role="group" aria-label={ui("View")}>
              <button type="button" aria-pressed={view === 'list'} aria-label={ui("List view")} onClick={() => changeView('list')} className={cn('grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground', view === 'list' && 'bg-accent text-foreground')}>
                <List className="size-4" />
              </button>
              <button type="button" aria-pressed={view === 'grid'} aria-label={ui("Grid view")} onClick={() => changeView('grid')} className={cn('grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground', view === 'grid' && 'bg-accent text-foreground')}>
                <LayoutGrid className="size-4" />
              </button>
              </div>
              <Button asChild variant="outline" size="sm"><Link to="/files/trash"><Trash2 /> {ui("Trash")}</Link></Button>
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={listing.isError}><Plus /> {ui("New")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{backgroundMenu}</DropdownMenuContent>
              </DropdownMenu>
            </div>
            <input
              ref={markdownInput}
              type="file"
              accept=".md,.markdown,text/markdown"
              multiple
              hidden
              onChange={(event) => {
                void importMarkdown([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
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
          </div>
        </div>

        {body}
      </div>

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
        {menu?.scope === 'items' ? itemMenu : backgroundMenu}
      </FileContextMenu>
      <FileMoveDialog nodes={moving} onOpenChange={(open) => { if (!open) setMoving(null) }} onMove={(targets, parentId) => ops.move(targets, parentId)} />
      <FilePreviewDialog
        node={previewing}
        onOpenChange={(open) => { if (!open) setPreviewing(null) }}
        onDownload={(node) => void downloadFile(node).catch(ops.fail)}
      />
      <FileToasts />
    </ScrollArea>
  )
}
