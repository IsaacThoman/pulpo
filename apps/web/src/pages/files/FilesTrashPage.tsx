import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { ArrowLeft, Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { deleteFileNode, emptyTrash, fetchTrash, filesQueryKey, restoreFileNode, trashQueryKey } from '@/features/files/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'

type PendingDeletion = { kind: 'item'; node: FileNode } | { kind: 'all' }

export function FilesTrashPage() {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const trash = useQuery({ queryKey: trashQueryKey(userId), queryFn: fetchTrash, enabled: Boolean(userId && filesEnabled) })
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDeletion | null>(null)
  const [busy, setBusy] = useState(false)
  const items = trash.data ?? []

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const confirmDeletion = () => {
    const target = pending
    setPending(null)
    if (target) void run(() => target.kind === 'all' ? emptyTrash() : deleteFileNode(target.node.id))
  }

  return (
    <ScrollArea className="h-full">
      <div className="mobile-page-content mx-auto max-w-6xl space-y-5 px-6 py-8">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link to="/files" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> {ui("My files")}
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{ui("Trash")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{ui("Items in the trash still count toward your storage and are deleted forever after 30 days.")}</p>
          </div>
          <Button variant="outline" size="sm" disabled={!items.length || busy} onClick={() => setPending({ kind: 'all' })}>
            <Trash2 /> {ui("Empty trash")}
          </Button>
        </div>

        {notice && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" className="cursor-pointer" aria-label={ui("Dismiss")} onClick={() => setNotice(null)}><X className="size-4" /></button>
          </div>
        )}

        {trash.isPending ? (
          <div className="grid h-48 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : trash.isError ? (
          <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">{filesErrorMessage(trash.error)}</p>
        ) : !items.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{ui("The trash is empty")}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {items.map((node) => (
              <li key={node.id} className="flex items-center gap-3 px-3 py-2">
                <FileNodeIcon node={node} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{node.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {node.trashedAt ? uit`Trashed ${timeAgo(Date.parse(node.trashedAt))}` : ''}
                    {node.kind === 'blob' ? ` · ${formatBytes(node.sizeBytes)}` : ''}
                  </span>
                </span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => restoreFileNode(node.id))}>
                  <RotateCcw /> <span className="hidden sm:inline">{ui("Restore")}</span>
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} className="text-destructive hover:text-destructive" aria-label={uit`Delete ${node.name} forever`} onClick={() => setPending({ kind: 'item', node })}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.kind === 'all' ? ui("Empty the trash?") : ui("Delete forever?")}</DialogTitle>
            <DialogDescription>
              {pending?.kind === 'item'
                ? uit`"${pending.node.name}" and everything inside it will be permanently deleted. This cannot be undone.`
                : ui("Everything in the trash will be permanently deleted. This cannot be undone.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{ui("Cancel")}</Button>
            <Button variant="destructive" onClick={confirmDeletion}>{ui("Delete forever")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
