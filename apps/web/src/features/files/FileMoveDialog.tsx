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

/** Folder picker that walks the tree one level at a time, starting from `startFolderId`. */
export function FolderPickerDialog({
  open,
  title,
  confirmLabel,
  startFolderId,
  excludedIds,
  isUnchanged,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  confirmLabel: string
  startFolderId: string | null
  /** Folders that cannot be chosen or entered, e.g. the ones being moved. */
  excludedIds?: ReadonlySet<string>
  /** Whether choosing this folder would change nothing, which disables the confirm button. */
  isUnchanged?: (folderId: string | null) => boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (folderId: string | null) => Promise<unknown>
}) {
  const userId = useAuth((state) => state.user?.id)
  const [folderId, setFolderId] = useState<string | null>(startFolderId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFolderId(startFolderId)
    setError(null)
  }, [open, startFolderId])

  const listing = useQuery({
    queryKey: folderQueryKey(userId, folderId),
    queryFn: () => fetchFolder(folderId),
    enabled: Boolean(open && userId),
  })
  const folders = (listing.data?.children ?? []).filter((child) => child.kind === 'folder')
  const trail = [...(listing.data?.ancestors ?? []), ...(listing.data?.folder ? [listing.data.folder] : [])]

  const confirm = async () => {
    setSaving(true)
    try {
      await onConfirm(folderId)
      onOpenChange(false)
    } catch (cause) {
      setError(filesErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
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
          {listing.isError && <p className="p-6 text-center text-sm text-destructive">{filesErrorMessage(listing.error)}</p>}
          {listing.isSuccess && folders.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{ui("No folders here")}</p>}
          {folders.map((folder) => {
            const excluded = excludedIds?.has(folder.id) ?? false
            return (
              <button
                key={folder.id}
                type="button"
                disabled={excluded}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setFolderId(folder.id)}
              >
                <FileNodeIcon node={folder} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                {!excluded && <ChevronRight className="size-4 text-muted-foreground" />}
              </button>
            )
          })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button type="button" disabled={saving || listing.isError || (isUnchanged?.(folderId) ?? false)} onClick={() => void confirm()}>
            {saving && <Loader2 className="animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Moves items to a folder chosen in the picker, starting from their current folder. */
export function FileMoveDialog({
  nodes,
  onOpenChange,
  onMove,
}: {
  nodes: FileNode[] | null
  onOpenChange: (open: boolean) => void
  onMove: (nodes: FileNode[], parentId: string | null) => Promise<unknown>
}) {
  const [shown, setShown] = useState(nodes)
  // Keep the last items while the dialog animates closed.
  useEffect(() => { if (nodes?.length) setShown(nodes) }, [nodes])
  const items = shown ?? []
  return (
    <FolderPickerDialog
      open={Boolean(nodes?.length)}
      title={items.length === 1 ? uit`Move "${items[0]!.name}"` : items.length ? uit`Move ${items.length} items` : ui("Move")}
      confirmLabel={ui("Move here")}
      startFolderId={items[0]?.parentId ?? null}
      excludedIds={new Set(items.map((node) => node.id))}
      isUnchanged={(folderId) => items.every((node) => node.parentId === folderId)}
      onOpenChange={onOpenChange}
      onConfirm={(folderId) => onMove(items, folderId)}
    />
  )
}
