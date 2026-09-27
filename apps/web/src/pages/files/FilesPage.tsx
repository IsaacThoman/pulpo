import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import {
  ChevronRight,
  Download,
  Eye,
  FolderInput,
  FilePlus2,
  FileUp,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import {
  createDoc,
  createFolder,
  downloadDocMarkdown,
  downloadFile,
  fetchFolder,
  filesQueryKey,
  folderQueryKey,
  trashFileNode,
  updateFileNode,
  uploadFile,
} from '@/features/files/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { FileMoveDialog } from '@/features/files/FileMoveDialog'
import { FileNameDialog } from '@/features/files/FileNameDialog'
import { FilePreviewDialog } from '@/features/files/FilePreviewDialog'

/** Drag payload for moving an existing item; external drops carry "Files" instead. */
const NODE_DRAG_TYPE = 'application/x-pulpo-file-node'
const VIEW_STORAGE_KEY = 'pulpo.files.view'
const UPLOAD_CONCURRENCY = 3

type FilesView = 'list' | 'grid'
interface UploadEntry { id: string; name: string; error?: string }

function readView(): FilesView {
  try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}

function isFileDrag(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

function isNodeDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(NODE_DRAG_TYPE)
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
  const [view, setView] = useState<FilesView>(readView)
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<FileNode | null>(null)
  const [moving, setMoving] = useState<FileNode | null>(null)
  const [previewing, setPreviewing] = useState<FileNode | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const markdownInput = useRef<HTMLInputElement>(null)

  const children = listing.data?.children ?? []
  const trail = [...(listing.data?.ancestors ?? []), ...(listing.data?.folder ? [listing.data.folder] : [])]
  const refresh = () => queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
  const report = (cause: unknown, name?: string) => setNotice(filesErrorMessage(cause, name))

  const changeView = (next: FilesView) => {
    setView(next)
    try { localStorage.setItem(VIEW_STORAGE_KEY, next) } catch { /* the preference is optional */ }
  }

  const open = (node: FileNode) => {
    if (node.kind === 'folder') navigate(`/files/f/${node.id}`)
    else if (node.kind === 'doc') navigate(`/files/d/${node.id}`)
    else setPreviewing(node)
  }

  const newDocument = async () => {
    try {
      const node = await createDoc(folderId, ui("Untitled document"))
      await refresh()
      navigate(`/files/d/${node.id}`)
    } catch (cause) {
      report(cause)
    }
  }

  /** Markdown files become editable documents; the file name without its extension becomes the title. */
  const importMarkdown = async (files: File[]) => {
    for (const file of files) {
      try {
        await createDoc(folderId, file.name.replace(/\.(md|markdown|txt)$/i, '') || ui("Untitled document"), await file.text())
      } catch (cause) {
        report(cause, file.name)
      }
    }
    await refresh()
  }

  const move = async (node: FileNode, parentId: string | null) => {
    await updateFileNode(node.id, { parentId, expectedRevision: node.revision })
    await refresh()
  }

  const moveById = (id: string, parentId: string | null) => {
    const node = children.find((child) => child.id === id)
    if (!node || node.id === parentId || node.parentId === parentId) return
    void move(node, parentId).catch((cause: unknown) => report(cause, node.name))
  }

  const trash = async (node: FileNode) => {
    try {
      await trashFileNode(node.id)
      await refresh()
    } catch (cause) {
      report(cause)
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
        await refresh()
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker))
  }

  /** Folder rows and breadcrumbs accept both uploads and moves; the page background accepts uploads. */
  const dropProps = (targetId: string | null, key = targetId ?? 'root') => ({
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event) && !isNodeDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = isNodeDrag(event) ? 'move' : 'copy'
      setDropTarget(key)
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === key ? null : current)
    },
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event) && !isNodeDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      const nodeId = event.dataTransfer.getData(NODE_DRAG_TYPE)
      if (nodeId) moveById(nodeId, targetId)
      else void upload([...event.dataTransfer.files], targetId)
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

  const actions = (node: FileNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={uit`Actions for ${node.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={() => open(node)}>
          <Eye /> {node.kind === 'blob' ? ui("Preview") : ui("Open")}
        </DropdownMenuItem>
        {node.kind === 'doc' && (
          <DropdownMenuItem onSelect={() => void downloadDocMarkdown(node).catch((cause: unknown) => report(cause))}>
            <Download /> {ui("Download as Markdown")}
          </DropdownMenuItem>
        )}
        {node.kind === 'blob' && (
          <DropdownMenuItem onSelect={() => void downloadFile(node).catch((cause: unknown) => report(cause))}>
            <Download /> {ui("Download")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setRenaming(node)}><Pencil /> {ui("Rename")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMoving(node)}><FolderInput /> {ui("Move")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void trash(node)}><Trash2 /> {ui("Move to trash")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const itemProps = (node: FileNode) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(NODE_DRAG_TYPE, node.id)
      event.dataTransfer.effectAllowed = 'move'
    },
    ...(node.kind === 'folder' ? dropProps(node.id) : {}),
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
  } else if (!children.length) {
    body = (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Upload className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{ui("This folder is empty")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ui("Drop files here, or use New to start a document, add a folder, or upload files.")}</p>
      </div>
    )
  } else if (view === 'grid') {
    body = (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
        {children.map((node) => (
          <div
            key={node.id}
            {...itemProps(node)}
            className={cn(
              'group relative flex flex-col rounded-xl border bg-card transition-colors hover:bg-accent/50',
              dropTarget === node.id && 'border-primary bg-primary/5 ring-2 ring-primary/30',
            )}
          >
            <button type="button" className="flex cursor-pointer flex-col items-center gap-2 px-3 pt-6 pb-3 text-center" onClick={() => open(node)}>
              <FileNodeIcon node={node} className="size-10" />
              <span className="line-clamp-2 w-full text-sm break-words">{node.name}</span>
            </button>
            <div className="absolute top-1 right-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">{actions(node)}</div>
          </div>
        ))}
      </div>
    )
  } else {
    body = (
      <div className="overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_6rem_2.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>{ui("Name")}</span>
          <span>{ui("Modified")}</span>
          <span className="text-right">{ui("Size")}</span>
          <span />
        </div>
        <ul className="divide-y">
          {children.map((node) => (
            <li
              key={node.id}
              {...itemProps(node)}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 px-3 transition-colors hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_9rem_6rem_2.5rem]',
                dropTarget === node.id && 'bg-primary/10 outline-2 -outline-offset-2 outline-primary/40',
              )}
            >
              <button type="button" className="flex min-w-0 cursor-pointer items-center gap-3 py-2.5 text-left" onClick={() => open(node)}>
                <FileNodeIcon node={node} className="size-5" />
                <span className="min-w-0 truncate text-sm">{node.name}</span>
              </button>
              <span className="hidden truncate text-sm text-muted-foreground sm:block">{timeAgo(Date.parse(node.updatedAt))}</span>
              <span className="hidden text-right text-sm text-muted-foreground tabular-nums sm:block">{node.kind === 'blob' ? formatBytes(node.sizeBytes) : '—'}</span>
              {actions(node)}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div
        {...pageDrop}
        className={cn(
          'mobile-page-content mx-auto min-h-full max-w-6xl space-y-5 px-6 py-8',
          dropTarget === 'page' && 'rounded-2xl bg-primary/5 outline-2 -outline-offset-8 outline-dashed outline-primary/40',
        )}
      >
        <div className="flex flex-wrap items-start gap-3">
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
          <div className="flex items-center gap-2">
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
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void newDocument()}><FilePlus2 /> {ui("New document")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCreating(true)}><FolderPlus /> {ui("New folder")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}><Upload /> {ui("Upload files")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => markdownInput.current?.click()}><FileUp /> {ui("Import Markdown as document")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

        {notice && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" className="cursor-pointer" aria-label={ui("Dismiss")} onClick={() => setNotice(null)}><X className="size-4" /></button>
          </div>
        )}

        {body}
      </div>

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

      <FileNameDialog
        open={creating}
        title={ui("New folder")}
        initialName={ui("Untitled folder")}
        submitLabel={ui("Create")}
        onOpenChange={setCreating}
        onSubmit={async (name) => { await createFolder(folderId, name); await refresh() }}
      />
      <FileNameDialog
        open={Boolean(renaming)}
        title={ui("Rename")}
        initialName={renaming?.name ?? ''}
        submitLabel={ui("Rename")}
        onOpenChange={(open) => { if (!open) setRenaming(null) }}
        onSubmit={async (name) => { if (renaming) await updateFileNode(renaming.id, { name, expectedRevision: renaming.revision }); await refresh() }}
      />
      <FileMoveDialog node={moving} onOpenChange={(open) => { if (!open) setMoving(null) }} onMove={move} />
      <FilePreviewDialog
        node={previewing}
        onOpenChange={(open) => { if (!open) setPreviewing(null) }}
        onDownload={(node) => void downloadFile(node).catch((cause: unknown) => report(cause))}
      />
    </ScrollArea>
  )
}
