import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DOC_FRAGMENT_NAME } from '@pulpo/client-core/doc-schema'
import type { FileNode } from '@pulpo/contracts'
import { ChevronRight, Cloud, CloudOff, Download, HardDrive, Loader2, MoreHorizontal, Trash2, TriangleAlert } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { downloadDocMarkdown, fetchFileNode, fileNodeQueryKey, filesQueryKey, trashFileNode, updateFileNode } from '@/features/files/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { DocEditor } from '@/features/files/editor/DocEditor'
import type { DocSyncStatus } from '@/features/files/editor/socket-provider'
import { useDocSession, type PresencePeer } from '@/features/files/editor/use-doc-session'

function statusProblem(status: DocSyncStatus): string | null {
  if (status.state === 'closed') {
    return status.reason === 'trashed'
      ? ui("This document was moved to the trash. Restore it to keep editing.")
      : ui("This document was deleted.")
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

function OpenDoc({ userId, docId }: { userId: string; docId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const nodeQuery = useQuery({ queryKey: fileNodeQueryKey(userId, docId), queryFn: () => fetchFileNode(docId) })
  const { session, status, peers } = useDocSession(userId, docId)
  const [everSynced, setEverSynced] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => setEverSynced(false), [docId])
  useEffect(() => { if (status.state === 'synced') setEverSynced(true) }, [status.state])

  const node = nodeQuery.data?.node
  const ancestors = nodeQuery.data?.ancestors ?? []
  const parentPath = node?.parentId ? `/files/f/${node.parentId}` : '/files'
  const problem = statusProblem(status)
  // Before the first sync, only allow typing when a cached copy is already on screen.
  const hasContent = Boolean(session && session.doc.getXmlFragment(DOC_FRAGMENT_NAME).length > 0)
  const editable = !problem && Boolean(node && !node.trashedAt) && (everSynced || hasContent)

  const trash = async () => {
    if (!node) return
    try {
      await trashFileNode(node.id)
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
      navigate(parentPath)
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
    }
  }

  if (nodeQuery.isError) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-xl border p-6 text-center">
          <TriangleAlert className="mx-auto size-8 text-amber-500" />
          <p className="mt-3 text-sm text-muted-foreground">{filesErrorMessage(nodeQuery.error)}</p>
          <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/files">{ui("Back to My files")}</Link></Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mobile-page-content flex items-center gap-3 border-b px-4 py-2 sm:px-6">
        <div className="min-w-0 flex-1">
          <nav aria-label={ui("Folder path")} className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
            <Link to="/files" className="flex shrink-0 items-center gap-1 rounded px-1 hover:text-foreground"><HardDrive className="size-3" />{ui("My files")}</Link>
            {ancestors.map((folder) => (
              <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight className="size-3 shrink-0" />
                <Link to={`/files/f/${folder.id}`} className="truncate rounded px-1 hover:text-foreground">{folder.name}</Link>
              </span>
            ))}
          </nav>
          {node ? <DocTitle node={node} /> : <div className="h-8" />}
        </div>
        <Presence peers={peers} />
        <SyncIndicator status={status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={ui("Document actions")} disabled={!node}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => node && void downloadDocMarkdown(node).catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}>
              <Download /> {ui("Download as Markdown")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void trash()}><Trash2 /> {ui("Move to trash")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {(problem || notice) && (
        <div role="alert" className={cn('flex items-center gap-2 border-b px-4 py-2 text-sm sm:px-6', problem ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-destructive/5 text-destructive')}>
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{problem ?? notice}</span>
          {status.state === 'error' && <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{ui("Reload")}</Button>}
          {status.state === 'closed' && <Button asChild size="sm" variant="outline"><Link to={status.reason === 'trashed' ? '/files/trash' : '/files'}>{status.reason === 'trashed' ? ui("Open trash") : ui("Back to My files")}</Link></Button>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {session ? (
          <DocEditor key={docId} session={session} editable={editable} />
        ) : (
          <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">{peers.length ? uit`${peers.length} other sessions are editing` : ''}</span>
    </div>
  )
}

export function FileDocPage() {
  const { docId } = useParams()
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  if (!filesEnabled) {
    return <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">{ui("Files are disabled by the administrator")}</div>
  }
  if (!userId || !docId) return null
  return <OpenDoc key={docId} userId={userId} docId={docId} />
}
