import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FILE_SCOPE_ROOT } from '@pulpo/contracts'
import { ChevronRight, Folder, HardDrive, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { fetchFileNode, fetchFolder, fileNodeQueryKey, folderQueryKey } from './api'
import { FileNodeIcon } from './FileNodeIcon'

function useScopeName(id: string): { name: string | null; missing: boolean } {
  const userId = useAuth((state) => state.user?.id)
  const root = id === FILE_SCOPE_ROOT
  const query = useQuery({
    queryKey: fileNodeQueryKey(userId, id),
    queryFn: () => fetchFileNode(id),
    enabled: Boolean(userId && !root),
    retry: false,
  })
  if (root) return { name: ui("My files"), missing: false }
  const node = query.data?.node
  return { name: node?.name ?? null, missing: query.isError || Boolean(node?.trashedAt) }
}

/** One folder the agent can use, shown in the composer like an attachment. */
export function FileScopeChip({ id, onRemove, className }: { id: string; onRemove?: () => void; className?: string }) {
  const { name, missing } = useScopeName(id)
  const Icon = id === FILE_SCOPE_ROOT ? HardDrive : Folder
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          'inline-flex h-8 max-w-56 items-center gap-1.5 rounded-lg bg-muted pr-1 pl-2.5 text-sm',
          missing && 'text-muted-foreground line-through',
          !onRemove && 'pr-2.5',
          className,
        )}>
          <Icon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span className="min-w-0 truncate">{name ?? '…'}</span>
          {onRemove && (
            <button
              type="button"
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground"
              aria-label={uit`Remove ${name ?? ui("folder")}`}
              onClick={onRemove}
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{missing ? ui("This folder is no longer available") : ui("The agent can read and edit files in this folder and its subfolders")}</TooltipContent>
    </Tooltip>
  )
}

/** Walks the Files tree one level at a time to choose a folder for the agent. */
export function FileScopePicker({
  open,
  onOpenChange,
  selected,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: readonly string[]
  onAdd: (id: string) => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const [folderId, setFolderId] = useState<string | null>(null)
  const listing = useQuery({
    queryKey: folderQueryKey(userId, folderId),
    queryFn: () => fetchFolder(folderId),
    enabled: Boolean(open && userId),
  })
  const folders = (listing.data?.children ?? []).filter((child) => child.kind === 'folder')
  const trail = [...(listing.data?.ancestors ?? []), ...(listing.data?.folder ? [listing.data.folder] : [])]
  const current = folderId ?? FILE_SCOPE_ROOT
  // A folder is already covered when it, or a folder above it, is in the scope.
  const covered = selected.includes(FILE_SCOPE_ROOT) || [current, ...trail.map((folder) => folder.id)].some((id) => selected.includes(id))

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setFolderId(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ui("Add a folder")}</DialogTitle>
          <DialogDescription>{ui("The agent can read and edit everything in the folder, including subfolders.")}</DialogDescription>
        </DialogHeader>
        <nav aria-label={ui("Folder path")} className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
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
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => setFolderId(folder.id)}
            >
              <FileNodeIcon node={folder} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button type="button" disabled={covered || listing.isPending} onClick={() => { onAdd(current); onOpenChange(false); setFolderId(null) }}>
            {covered ? ui("Already added") : folderId ? uit`Add "${trail.at(-1)?.name ?? ''}"` : ui("Add all files")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
