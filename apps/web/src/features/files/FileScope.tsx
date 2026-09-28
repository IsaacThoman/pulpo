import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FILE_SCOPE_ROOT, MAX_CHAT_FILE_SCOPES, type FileNode } from '@pulpo/contracts'
import { Check, ChevronRight, HardDrive, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { fetchFileNode, fetchFolder, fileNodeQueryKey, folderQueryKey } from './api'
import { FileNodeIcon } from './FileNodeIcon'

function useScopeNode(id: string): { node: FileNode | null; missing: boolean } {
  const userId = useAuth((state) => state.user?.id)
  const root = id === FILE_SCOPE_ROOT
  const query = useQuery({
    queryKey: fileNodeQueryKey(userId, id),
    queryFn: () => fetchFileNode(id),
    enabled: Boolean(userId && !root),
    retry: false,
  })
  const node = query.data?.node ?? null
  return { node, missing: !root && (query.isError || Boolean(node?.trashedAt)) }
}

/** One file or folder the agent can use, shown in the composer like an attachment. */
export function FileScopeChip({ id, onRemove, className }: { id: string; onRemove?: () => void; className?: string }) {
  const { node, missing } = useScopeNode(id)
  const root = id === FILE_SCOPE_ROOT
  const name = root ? ui("My files") : node?.name ?? null
  const hint = missing
    ? ui("This item is no longer available")
    : root || node?.kind === 'folder'
      ? ui("The agent can read and edit files in this folder and its subfolders")
      : ui("The agent can read and edit this file")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          'inline-flex h-8 max-w-56 items-center gap-1.5 rounded-lg bg-muted pr-1 pl-2.5 text-sm',
          missing && 'text-muted-foreground line-through',
          !onRemove && 'pr-2.5',
          className,
        )}>
          {root
            ? <HardDrive className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            : node ? <FileNodeIcon node={node} className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
          <span className="min-w-0 truncate">{name ?? '…'}</span>
          {onRemove && (
            <button
              type="button"
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground"
              aria-label={uit`Remove ${name ?? ui("item")}`}
              onClick={onRemove}
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  )
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={cn(
      'grid size-4 shrink-0 place-items-center rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]',
      checked && 'bg-sky-600 shadow-none dark:bg-sky-500',
    )}>
      {checked && <Check className="size-3 text-white" strokeWidth={3} />}
    </span>
  )
}

/**
 * Chooses files and folders for the agent. Folders open on click; checking items keeps them
 * selected while browsing elsewhere. With nothing checked, the folder being viewed is added.
 */
export function FileScopePicker({
  open,
  onOpenChange,
  selected,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Items already in the chat's scope. */
  selected: readonly string[]
  onAdd: (ids: string[]) => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Map<string, FileNode>>(new Map())
  const listing = useQuery({
    queryKey: folderQueryKey(userId, folderId),
    queryFn: () => fetchFolder(folderId),
    enabled: Boolean(open && userId),
  })
  const children = listing.data?.children ?? []
  const trail = [...(listing.data?.ancestors ?? []), ...(listing.data?.folder ? [listing.data.folder] : [])]
  const current = folderId ?? FILE_SCOPE_ROOT
  // Everything here is already available when this folder, or one above it, is in the scope.
  const covered = selected.includes(FILE_SCOPE_ROOT) || [current, ...trail.map((folder) => folder.id)].some((id) => selected.includes(id))
  const room = MAX_CHAT_FILE_SCOPES - selected.length

  const toggle = (node: FileNode) => setChecked((previous) => {
    const next = new Map(previous)
    if (next.has(node.id)) next.delete(node.id)
    else if (next.size < room) next.set(node.id, node)
    return next
  })
  const add = () => {
    onAdd(checked.size ? [...checked.keys()] : [current])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ui("Add from Files")}</DialogTitle>
          <DialogDescription>{ui("The agent can read and edit what you add. Folders include their subfolders.")}</DialogDescription>
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
        <div role="listbox" aria-multiselectable="true" aria-label={ui("Files")} className="h-72 overflow-y-auto rounded-lg border">
          {listing.isPending && <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {!listing.isPending && children.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{ui("This folder is empty")}</p>}
          {children.map((node) => {
            const already = covered || selected.includes(node.id)
            const isChecked = already || checked.has(node.id)
            const folder = node.kind === 'folder'
            return (
              <div key={node.id} role="option" aria-selected={isChecked} className={cn('flex items-center hover:bg-accent', isChecked && !already && 'bg-sky-500/10')}>
                <button
                  type="button"
                  disabled={already || (!checked.has(node.id) && checked.size >= room)}
                  aria-label={isChecked ? uit`Deselect ${node.name}` : uit`Select ${node.name}`}
                  className="grid size-10 shrink-0 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => toggle(node)}
                >
                  <CheckMark checked={isChecked} />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pr-3 text-left text-sm"
                  onClick={() => folder ? setFolderId(node.id) : !already && toggle(node)}
                >
                  <FileNodeIcon node={node} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  {folder && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                </button>
              </div>
            )
          })}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{checked.size ? uit`${checked.size} selected` : covered ? ui("Already added") : null}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="button" disabled={listing.isPending || room <= 0 || (!checked.size && covered)} onClick={add}>
              {checked.size
                ? checked.size === 1 ? uit`Add "${[...checked.values()][0]!.name}"` : uit`Add ${checked.size} items`
                : folderId ? uit`Add "${trail.at(-1)?.name ?? ''}"` : ui("Add all files")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
