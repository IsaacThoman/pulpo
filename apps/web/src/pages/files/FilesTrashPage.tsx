import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { ArrowLeft, Loader2, RotateCcw, SquareDashedMousePointer, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { emptyTrash, fetchTrash, trashQueryKey } from '@/features/files/api'
import { filesErrorMessage } from '@/features/files/file-display'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { FileToasts } from '@/features/files/browser/FileToasts'
import { clickSelect, EMPTY_SELECTION, pruneSelection, selectAll, selectOnly, type FileSelection } from '@/features/files/browser/selection'
import { hasPrimaryModifier, isEditableTarget, shortcutLabel } from '@/features/files/browser/shortcuts'
import { useFileOperations } from '@/features/files/browser/use-file-operations'

type PendingDeletion = { kind: 'selection'; nodes: FileNode[] } | { kind: 'all' }

export function FilesTrashPage() {
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const trash = useQuery({ queryKey: trashQueryKey(userId), queryFn: fetchTrash, enabled: Boolean(userId && filesEnabled) })
  const ops = useFileOperations()
  const [selection, setSelection] = useState<FileSelection>(EMPTY_SELECTION)
  const [menu, setMenu] = useState<ContextMenuPoint | null>(null)
  const [pending, setPending] = useState<PendingDeletion | null>(null)
  const items = useMemo(() => trash.data ?? [], [trash.data])
  const order = useMemo(() => items.map((node) => node.id), [items])
  const selectedNodes = items.filter((node) => selection.ids.has(node.id))

  useEffect(() => setSelection((current) => pruneSelection(current, order)), [order])

  const restore = async (nodes = selectedNodes) => {
    setSelection(EMPTY_SELECTION)
    await ops.restore(nodes)
  }

  const confirmDeletion = async () => {
    const target = pending
    setPending(null)
    if (!target) return
    setSelection(EMPTY_SELECTION)
    if (target.kind === 'selection') {
      await ops.deleteForever(target.nodes)
      return
    }
    try {
      await emptyTrash()
      ops.notify(ui("Emptied the trash"))
    } catch (cause) {
      ops.fail(cause)
    } finally {
      await ops.refresh()
    }
  }

  const handleKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditableTarget(event.target) || pending || menu) return
    const mod = hasPrimaryModifier(event)
    if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection(selectAll(order)); return }
    if (event.key === 'Escape') { setSelection(EMPTY_SELECTION); return }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodes.length) {
      event.preventDefault()
      setPending({ kind: 'selection', nodes: selectedNodes })
    }
  }
  const handleKeyRef = useRef(handleKey)
  handleKeyRef.current = handleKey
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const openMenu = (event: MouseEvent, node: FileNode | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (node && !selection.ids.has(node.id)) setSelection(selectOnly(node.id))
    if (!node) setSelection(EMPTY_SELECTION)
    setMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <ScrollArea className="h-full">
      <div
        className="mobile-page-content mx-auto min-h-full max-w-6xl space-y-4 px-6 py-8"
        onClick={(event) => { if (!(event.target as Element).closest('[data-file-id], button, a')) setSelection(EMPTY_SELECTION) }}
        onContextMenu={(event) => { if (!(event.target as Element).closest('[data-file-id]') && items.length) openMenu(event, null) }}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link to="/files" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> {ui("My files")}
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{ui("Trash")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{ui("Items in the trash still count toward your storage and are deleted forever after 30 days.")}</p>
          </div>
          {/* The selection bar takes the place of Empty trash so the list never shifts. */}
          {selectedNodes.length > 0 ? (
            <div role="toolbar" aria-label={ui("Selection")} className="flex h-8 items-center gap-0.5 rounded-lg border bg-sky-500/10 px-0.5 dark:bg-sky-400/10">
              <button type="button" aria-label={ui("Clear selection")} title={ui("Clear selection")} onClick={() => setSelection(EMPTY_SELECTION)} className="grid size-6.5 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground">
                <X className="size-4" />
              </button>
              <span className="px-1.5 text-sm font-medium whitespace-nowrap tabular-nums">{selectedNodes.length === 1 ? ui("1 selected") : uit`${selectedNodes.length} selected`}</span>
              <Button variant="ghost" size="sm" className="h-6.5" onClick={() => void restore()}><RotateCcw /> {ui("Restore")}</Button>
              <Button variant="ghost" size="sm" className="h-6.5 text-destructive hover:text-destructive" onClick={() => setPending({ kind: 'selection', nodes: selectedNodes })}>
                <Trash2 /> <span className="hidden sm:inline">{ui("Delete forever")}</span>
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" disabled={!items.length} onClick={() => setPending({ kind: 'all' })}>
              <Trash2 /> {ui("Empty trash")}
            </Button>
          )}
        </div>

        {trash.isPending ? (
          <div className="grid h-48 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : trash.isError ? (
          <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">{filesErrorMessage(trash.error)}</p>
        ) : !items.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{ui("The trash is empty")}</p>
        ) : (
          <div role="listbox" aria-multiselectable aria-label={ui("Trash")} className="divide-y overflow-hidden rounded-xl border">
            {items.map((node) => {
              const selected = selection.ids.has(node.id)
              return (
                <div
                  key={node.id}
                  data-file-id={node.id}
                  role="option"
                  aria-selected={selected}
                  onClick={(event) => setSelection(clickSelect(selection, order, node.id, { toggle: hasPrimaryModifier(event), range: event.shiftKey }))}
                  onContextMenu={(event) => openMenu(event, node)}
                  className={cn('flex cursor-default items-center gap-3 px-3 py-2 select-none hover:bg-accent/50', selected && 'bg-sky-500/15 shadow-[inset_3px_0_0_var(--color-sky-500)] hover:bg-sky-500/20 dark:bg-sky-400/15')}
                >
                  <FileNodeIcon node={node} className="size-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{node.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {node.trashedAt ? uit`Trashed ${timeAgo(Date.parse(node.trashedAt))}` : ''}
                      {node.kind === 'blob' ? ` · ${formatBytes(node.sizeBytes)}` : ''}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); void restore([node]) }}>
                    <RotateCcw /> <span className="hidden sm:inline">{ui("Restore")}</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={uit`Delete ${node.name} forever`} onClick={(event) => { event.stopPropagation(); setPending({ kind: 'selection', nodes: [node] }) }}>
                    <Trash2 />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <FileContextMenu point={menu} onClose={() => setMenu(null)}>
        {selectedNodes.length > 0 ? (
          <>
            {selectedNodes.length > 1 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{uit`${selectedNodes.length} items selected`}</DropdownMenuLabel>}
            <DropdownMenuItem onSelect={() => void restore()}><RotateCcw /> {ui("Restore")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setPending({ kind: 'selection', nodes: selectedNodes })}>
              <Trash2 /> {ui("Delete forever")}<DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => setSelection(selectAll(order))}>
              <SquareDashedMousePointer /> {ui("Select all")}<DropdownMenuShortcut>{shortcutLabel('A', { mod: true })}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setPending({ kind: 'all' })}><Trash2 /> {ui("Empty trash")}</DropdownMenuItem>
          </>
        )}
      </FileContextMenu>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.kind === 'all' ? ui("Empty the trash?") : ui("Delete forever?")}</DialogTitle>
            <DialogDescription>
              {pending?.kind === 'selection'
                ? (pending.nodes.length === 1
                  ? uit`"${pending.nodes[0]!.name}" and everything inside it will be permanently deleted. This cannot be undone.`
                  : uit`${pending.nodes.length} items and everything inside them will be permanently deleted. This cannot be undone.`)
                : ui("Everything in the trash will be permanently deleted. This cannot be undone.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{ui("Cancel")}</Button>
            <Button variant="destructive" onClick={() => void confirmDeletion()}>{ui("Delete forever")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FileToasts />
    </ScrollArea>
  )
}
