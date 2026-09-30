import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DOC_FRAGMENT_NAME } from '@pulpo/client-core/doc-schema'
import { isMarkdownName, type FileConversionPreview, type FileNode } from '@pulpo/contracts'
import { ChevronRight, Cloud, CloudOff, Download, HardDrive, Loader2, MoreHorizontal, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { Markdown } from '@/components/chat/Markdown'
import {
  convertToDoc,
  downloadDocMarkdown,
  downloadFile,
  fetchConversionPreview,
  fetchFileBlob,
  fetchFileNode,
  fileNodeQueryKey,
  filesQueryKey,
  trashFileNode,
  updateFileNode,
} from '@/features/files/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { DocEditor } from '@/features/files/editor/DocEditor'
import type { DocSyncStatus } from '@/features/files/editor/socket-provider'
import { useDocSession, type PresencePeer } from '@/features/files/editor/use-doc-session'
import { FilePreviewBody } from '@/features/files/FilePreviewDialog'
import { MarkdownConversionDialog } from '@/features/files/MarkdownConversionDialog'
import { PanelWindowButtons } from '@/features/side-panel/PanelControls'
import { openBeside, panelContentPath, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { SplitViewButton } from '@/features/side-panel/AgentActions'
import { usePublishFilesView, type AgentItem, type FilesViewPlace } from '@/features/side-panel/agent'
import { useSidePanel, type PanelContent } from '@/features/side-panel/store'

function statusProblem(status: DocSyncStatus): string | null {
  if (status.state === 'closed') {
    if (status.reason === 'trashed') return ui("This document was moved to the trash. Restore it to keep editing.")
    if (status.reason === 'converted') return ui("This file was renamed without a Markdown extension, so it's no longer editable.")
    return ui("This document was deleted.")
  }
  if (status.state !== 'error' || status.error === 'rate_limited') return null
  switch (status.error) {
    case 'schema_outdated': return ui("A newer version of Pulpo is available. Reload to keep editing.")
    case 'doc_too_large': return ui("This document is too large to edit.")
    case 'unauthorized': return ui("You can't edit this document.")
    default: return ui("Syncing stopped. Reload to keep editing.")
  }
}

function SyncIndicator({ status }: { status: DocSyncStatus }) {
  if (status.state === 'synced') return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Cloud className="size-3.5" />{ui("Saved")}</span>
  if (status.state === 'offline') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><CloudOff className="size-3.5" />{ui("Offline")}</span>
        </TooltipTrigger>
        <TooltipContent>{ui("Edits are kept on this device and sync when you reconnect.")}</TooltipContent>
      </Tooltip>
    )
  }
  if (status.state === 'connecting' || (status.state === 'error' && status.error === 'rate_limited')) {
    return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{ui("Syncing")}</span>
  }
  return null
}

function Presence({ peers }: { peers: PresencePeer[] }) {
  if (!peers.length) return null
  return (
    <div className="flex items-center -space-x-1.5" aria-label={ui("Also editing")}>
      {peers.slice(0, 4).map((peer) => (
        <Tooltip key={peer.clientId}>
          <TooltipTrigger asChild>
            <span
              className="grid size-6 place-items-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
              style={{ backgroundColor: peer.color }}
            >
              {peer.name.slice(0, 1).toUpperCase()}
            </span>
          </TooltipTrigger>
          <TooltipContent>{peer.name}</TooltipContent>
        </Tooltip>
      ))}
      {peers.length > 4 && <span className="grid size-6 place-items-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold">+{peers.length - 4}</span>}
    </div>
  )
}

function DocTitle({ node }: { node: FileNode }) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const [name, setName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setName(node.name), [node.name])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === node.name) {
      setName(node.name)
      return
    }
    try {
      await updateFileNode(node.id, { name: trimmed, expectedRevision: node.revision })
      setError(null)
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    } catch (cause) {
      setError(filesErrorMessage(cause, trimmed))
      setName(node.name)
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        value={name}
        aria-label={ui("Document name")}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') { setName(node.name); event.currentTarget.blur() }
        }}
        className="w-full min-w-0 truncate rounded-md bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-tight outline-none hover:bg-accent/60 focus:bg-accent/60"
      />
      {error && <p className="px-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}

/**
 * The folders above a file. In the side panel they open there, so the panel can walk back up;
 * Alt/Option-click opens one in the other view, as in the Files browser.
 */
function FilePath({ ancestors, inPanel }: { ancestors: FileNode[]; inPanel: boolean }) {
  const goMain = useMainNavigate()
  const showInPanel = (id: string | null) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    const folder = { kind: 'folder' as const, id }
    if (event.altKey) {
      event.preventDefault()
      if (inPanel) {
        useSidePanel.getState().close()
        goMain(panelContentPath(folder))
      } else {
        openBeside(folder, goMain)
      }
    } else if (inPanel) {
      event.preventDefault()
      useSidePanel.getState().open(folder)
    }
  }
  return (
    <nav aria-label={ui("Folder path")} className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      <Link to="/files" onClick={showInPanel(null)} className="flex shrink-0 items-center gap-1 rounded px-1 hover:text-foreground"><HardDrive className="size-3" />{ui("My files")}</Link>
      {ancestors.map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="size-3 shrink-0" />
          <Link to={`/files/f/${folder.id}`} onClick={showInPanel(folder.id)} className="truncate rounded px-1 hover:text-foreground">{folder.name}</Link>
        </span>
      ))}
    </nav>
  )
}

/** Where a file view renders: the full page, or the side panel next to another view. */
interface FileViewContext {
  layout: 'page' | 'panel'
  /** Set in the side panel, for its window controls. */
  panel?: PanelContent
}

const PAGE_VIEW: FileViewContext = { layout: 'page' }

/** Title bar shared by every file view; in the side panel it adds full-page and close buttons. */
function FileHeader({ node, ancestors, view, menu, children }: {
  node: FileNode | undefined
  ancestors: FileNode[]
  view: FileViewContext
  menu: ReactNode
  children?: ReactNode
}) {
  const place = useMemo<FilesViewPlace | null>(() => node ? { layout: view.layout, view: { kind: 'file', id: node.id } } : null, [node, view.layout])
  const item = useMemo<AgentItem | null>(() => node ? { id: node.id } : null, [node])
  usePublishFilesView(place ?? { layout: view.layout, view: { kind: 'folder', id: null } }, item)
  return (
    <header className={cn('flex items-center gap-1.5 border-b px-4 py-1.5', view.layout === 'panel' ? 'side-panel-header' : 'mobile-page-content')}>
      <div className="min-w-0 flex-1">
        <FilePath ancestors={ancestors} inPanel={view.layout === 'panel'} />
        {node ? <DocTitle node={node} /> : <div className="h-8" />}
      </div>
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={ui("Document actions")} disabled={!node}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
      {view.panel ? <PanelWindowButtons content={view.panel} /> : place && <SplitViewButton view={place.view} />}
    </header>
  )
}

function useLeaveAfterTrash(node: FileNode | undefined, view: FileViewContext) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  return async () => {
    if (!node) return
    await trashFileNode(node.id)
    await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    // The panel steps back to the file's folder; the page goes there.
    if (view.layout === 'panel') useSidePanel.getState().open({ kind: 'folder', id: node.parentId })
    else navigate(node.parentId ? `/files/f/${node.parentId}` : '/files')
  }
}

function OpenDoc({ userId, docId, view }: { userId: string; docId: string; view: FileViewContext }) {
  const nodeQuery = useQuery({ queryKey: fileNodeQueryKey(userId, docId), queryFn: () => fetchFileNode(docId) })
  const { session, status, peers } = useDocSession(userId, docId)
  const [everSynced, setEverSynced] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const chatWidth = useSettings((state) => state.chatWidth)

  useEffect(() => setEverSynced(false), [docId])
  useEffect(() => { if (status.state === 'synced') setEverSynced(true) }, [status.state])

  const node = nodeQuery.data?.node
  const ancestors = nodeQuery.data?.ancestors ?? []
  const parentPath = node?.parentId ? `/files/f/${node.parentId}` : '/files'
  const problem = statusProblem(status)
  // Before the first sync, only allow typing when a cached copy is already on screen.
  const hasContent = Boolean(session && session.doc.getXmlFragment(DOC_FRAGMENT_NAME).length > 0)
  const editable = !problem && Boolean(node && !node.trashedAt) && (everSynced || hasContent)
  const trash = useLeaveAfterTrash(node, view)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileHeader
        node={node}
        ancestors={ancestors}
        view={view}
        menu={(
          <>
            <DropdownMenuItem onSelect={() => node && void downloadDocMarkdown(node).catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}>
              <Download /> {ui("Download")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void trash().catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}><Trash2 /> {ui("Move to trash")}</DropdownMenuItem>
          </>
        )}
      >
        <Presence peers={peers} />
        <SyncIndicator status={status} />
      </FileHeader>

      {(problem || notice) && (
        <div role="alert" className={cn('flex items-center gap-2 border-b px-4 py-2 text-sm sm:px-6', problem ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-destructive/5 text-destructive')}>
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{problem ?? notice}</span>
          {status.state === 'error' && <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{ui("Reload")}</Button>}
          {status.state === 'closed' && <Button asChild size="sm" variant="outline"><Link to={status.reason === 'trashed' ? '/files/trash' : parentPath}>{status.reason === 'trashed' ? ui("Open trash") : ui("Back to My files")}</Link></Button>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {session ? (
          <DocEditor key={docId} session={session} editable={editable} width={view.layout === 'panel' ? 'fill' : chatWidth === 'full' ? 'wide' : 'narrow'} />
        ) : (
          <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">{peers.length ? uit`${peers.length} other sessions are editing` : ''}</span>
    </div>
  )
}

function contentWidth(view: FileViewContext, chatWidth: 'full' | 'narrow'): string {
  if (view.layout === 'panel') return 'w-full px-5 py-5'
  return cn('mx-auto w-full px-4 py-8 sm:px-6', chatWidth === 'full' ? 'max-w-[min(100%,90rem)]' : 'max-w-5xl')
}

/**
 * An uploaded Markdown file keeps its original bytes and opens read-only. Edit converts it into
 * an editable document, after showing what the editor's formatting would change, if anything.
 */
function MarkdownFileView({ node, ancestors, view }: { node: FileNode; ancestors: FileNode[]; view: FileViewContext }) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const chatWidth = useSettings((state) => state.chatWidth)
  const content = useQuery({
    queryKey: [...fileNodeQueryKey(userId, node.id), 'content', node.updatedAt],
    queryFn: async () => (await fetchFileBlob(node)).text(),
  })
  const [preview, setPreview] = useState<FileConversionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const trash = useLeaveAfterTrash(node, view)

  const convert = async () => {
    setBusy(true)
    try {
      await convertToDoc(node.id)
      // The route re-reads the node and switches to the editor.
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
      setPreview(null)
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const startEditing = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const dryRun = await fetchConversionPreview(node.id)
      if (dryRun.changed) setPreview(dryRun)
      else await convert()
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileHeader
        node={node}
        ancestors={ancestors}
        view={view}
        menu={(
          <>
            <DropdownMenuItem onSelect={() => void downloadFile(node).catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}>
              <Download /> {ui("Download")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void trash().catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}><Trash2 /> {ui("Move to trash")}</DropdownMenuItem>
          </>
        )}
      >
        <span className={cn('text-xs text-muted-foreground', view.layout === 'panel' ? 'hidden' : 'hidden sm:inline')}>{ui("Read-only")}</span>
        <Button size="sm" disabled={busy || node.trashedAt !== null} onClick={() => void startEditing()}>
          {busy ? <Loader2 className="animate-spin" /> : <Pencil />} {ui("Edit")}
        </Button>
      </FileHeader>
      {notice && (
        <div role="alert" className="flex items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-sm text-destructive sm:px-6">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={contentWidth(view, chatWidth)}>
          {content.isPending ? (
            <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : content.isError ? (
            <p className="text-sm text-destructive">{filesErrorMessage(content.error)}</p>
          ) : content.data.trim() ? (
            <Markdown content={content.data} />
          ) : (
            <p className="text-sm text-muted-foreground">{ui("This file is empty.")}</p>
          )}
        </div>
      </div>
      <MarkdownConversionDialog preview={preview} busy={busy} onCancel={() => setPreview(null)} onConfirm={() => void convert()} />
    </div>
  )
}

/** Any other uploaded file: a preview filling the page or panel, with download and trash. */
function BlobFileView({ node, ancestors, view }: { node: FileNode; ancestors: FileNode[]; view: FileViewContext }) {
  const [notice, setNotice] = useState<string | null>(null)
  const trash = useLeaveAfterTrash(node, view)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileHeader
        node={node}
        ancestors={ancestors}
        view={view}
        menu={(
          <>
            <DropdownMenuItem onSelect={() => void downloadFile(node).catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}>
              <Download /> {ui("Download")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void trash().catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}><Trash2 /> {ui("Move to trash")}</DropdownMenuItem>
          </>
        )}
      >
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatBytes(node.sizeBytes)}</span>
      </FileHeader>
      {notice && <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive sm:px-6">{notice}</p>}
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
        <FilePreviewBody node={node} fill />
      </div>
    </div>
  )
}

function FileViewMessage({ message, view, back }: { message: string; view: FileViewContext; back: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md rounded-xl border p-6 text-center">
        <TriangleAlert className="mx-auto size-8 text-amber-500" />
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {view.layout === 'panel'
          ? <Button variant="outline" size="sm" className="mt-4" onClick={() => useSidePanel.getState().close()}>{ui("Close")}</Button>
          : <Button asChild variant="outline" size="sm" className="mt-4"><Link to={back}>{ui("Back to My files")}</Link></Button>}
      </div>
    </div>
  )
}

/** Opens a file by what its name says it is: Markdown is edited, anything else previews. */
function FileRoute({ userId, fileId, view }: { userId: string; fileId: string; view: FileViewContext }) {
  const nodeQuery = useQuery({ queryKey: fileNodeQueryKey(userId, fileId), queryFn: () => fetchFileNode(fileId) })
  if (nodeQuery.isPending) return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  const node = nodeQuery.data?.node
  const back = node?.parentId ? `/files/f/${node.parentId}` : '/files'
  if (nodeQuery.isError || !node) return <FileViewMessage message={filesErrorMessage(nodeQuery.error)} view={view} back={back} />
  if (node.kind === 'folder') return <FileViewMessage message={ui("Folders open in the Files view.")} view={view} back={`/files/f/${node.id}`} />
  if (node.kind === 'doc') return <OpenDoc key={`doc:${fileId}`} userId={userId} docId={fileId} view={view} />
  const ancestors = nodeQuery.data.ancestors
  if (isMarkdownName(node.name)) return <MarkdownFileView key={`md:${fileId}`} node={node} ancestors={ancestors} view={view} />
  return <BlobFileView key={`blob:${fileId}`} node={node} ancestors={ancestors} view={view} />
}

export function FileDocPage() {
  const { docId } = useParams()
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  // Opening the side panel's file full page moves it here instead of showing it twice.
  useEffect(() => {
    const shown = useSidePanel.getState().content
    if (docId && shown?.kind === 'file' && shown.id === docId) useSidePanel.getState().close()
  }, [docId])
  if (!filesEnabled) {
    return <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">{ui("Files are disabled by the administrator")}</div>
  }
  if (!userId || !docId) return null
  return <FileRoute key={docId} userId={userId} fileId={docId} view={PAGE_VIEW} />
}

/** The side panel's content: the same file views in a compact layout. */
export function FilePanelView({ fileId }: { fileId: string }) {
  const userId = useAuth((state) => state.user?.id)
  const view = useMemo<FileViewContext>(() => ({ layout: 'panel', panel: { kind: 'file', id: fileId } }), [fileId])
  if (!userId) return null
  return <FileRoute key={fileId} userId={userId} fileId={fileId} view={view} />
}
