import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { ChevronRight, HardDrive, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { fetchFolder, folderQueryKey } from './api'
import { filesErrorMessage } from './file-display'
import { FileNodeIcon } from './FileNodeIcon'

/** Folder picker that walks the tree one level at a time, starting from the items' current folder. */
export function FileMoveDialog({
  nodes,
  onOpenChange,
  onMove,
}: {
  nodes: FileNode[] | null
  onOpenChange: (open: boolean) => void
  onMove: (nodes: FileNode[], parentId: string | null) => Promise<unknown>
}) {
  const userId = useAuth((state) => state.user?.id)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!nodes?.length) return
    setFolderId(nodes[0]!.parentId)
    setError(null)
  }, [nodes])

  const listing = useQuery({
    queryKey: folderQueryKey(userId, folderId),
    queryFn: () => fetchFolder(folderId),
    enabled: Boolean(nodes?.length && userId),
  })
  const folders = (listing.data?.children ?? []).filter((child) => child.kind === 'folder')
  const trail = [...(listing.data?.ancestors ?? []), ...(listing.data?.folder ? [listing.data.folder] : [])]
  const moving = new Set(nodes?.map((node) => node.id))
  const unchanged = Boolean(nodes?.every((node) => node.parentId === folderId))

  const move = async () => {
    if (!nodes?.length) return
    setSaving(true)
    try {
      await onMove(nodes, folderId)
      onOpenChange(false)
    } catch (cause) {
      setError(filesErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(nodes?.length)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{nodes?.length === 1 ? uit`Move "${nodes[0]!.name}"` : nodes?.length ? uit`Move ${nodes.length} items` : ui("Move")}</DialogTitle>
          <DialogDescription>{ui("Choose a destination folder.")}</DialogDescription>
        </DialogHeader>
        <nav aria-label={ui("Destination path")} className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
          <button type="button" className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => setFolderId(null)}>
            <HardDrive className="size-3.5" />{ui("My files")}
          </button>
          {trail.map((folder) => (
            <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              <button type="button" className="max-w-40 cursor-pointer truncate rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => setFolderId(folder.id)}>{folder.name}</button>
            </span>
          ))}
        </nav>
        <div className="h-64 overflow-y-auto rounded-lg border">
          {listing.isPending && <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {!listing.isPending && folders.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{ui("No folders here")}</p>}
          {folders.map((folder) => {
            const self = moving.has(folder.id)
            return (
              <button
                key={folder.id}
                type="button"
                disabled={self}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setFolderId(folder.id)}
              >
                <FileNodeIcon node={folder} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                {!self && <ChevronRight className="size-4 text-muted-foreground" />}
              </button>
            )
          })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button type="button" disabled={saving || unchanged} onClick={() => void move()}>{ui("Move here")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
