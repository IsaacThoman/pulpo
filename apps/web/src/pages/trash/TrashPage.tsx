import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TrashItem } from '@pulpo/contracts'
import { Loader2, RotateCcw, SquareDashedMousePointer, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSettingsDialog } from '@/components/settings/settings-dialog'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { formatDateTime, timeAgo } from '@/lib/format'
import { clearLocalChats } from '@/lib/local-first/chat-cache'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { deleteTrashItems, emptyTrash, fetchTrash, restoreTrashItems, retrashItems, trashQueryKey } from '@/features/trash/api'
import { trashDeletesLabel, trashRetentionSummary } from '@/features/trash/labels'
import { filesErrorMessage } from '@/features/files/file-display'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { useFileToasts } from '@/features/files/browser/toasts'
import { clickSelect, EMPTY_SELECTION, pruneSelection, selectAll, selectOnly, type FileSelection } from '@/features/files/browser/selection'
import { hasPrimaryModifier, isEditableTarget, shortcutLabel } from '@/features/files/browser/shortcuts'
import { SelectionAction } from '@/features/files/browser/SelectionAction'

type PendingDeletion = { kind: 'selection'; items: TrashItem[] } | { kind: 'all' }
type TrashFilter = 'all' | 'chats' | 'files'

const matchesFilter = (item: TrashItem, filter: TrashFilter) =>
  filter === 'all' || (filter === 'chats') === (item.kind === 'chat')

function count(items: readonly TrashItem[], one: (name: string) => string, many: (count: number) => string): string {
  return items.length === 1 ? one(items[0]!.name) : many(items.length)
}

/** One trash for chats and Files items, under the retention setting in Settings → Trash. */
export function TrashPage() {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const { openSettings } = useSettingsDialog()
  const show = useFileToasts((state) => state.show)
  const trash = useQuery({ queryKey: trashQueryKey(userId), queryFn: fetchTrash, enabled: Boolean(userId), refetchInterval: 60_000 })
  const [filter, setFilter] = useState<TrashFilter>('all')
  const [selection, setSelection] = useState<FileSelection>(EMPTY_SELECTION)
  const [menu, setMenu] = useState<ContextMenuPoint | null>(null)
  const [pending, setPending] = useState<PendingDeletion | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const all = useMemo(() => trash.data?.items ?? [], [trash.data])
  const items = useMemo(() => all.filter((item) => matchesFilter(item, filter)), [all, filter])
  const order = useMemo(() => items.map((item) => item.id), [items])
  const selectedItems = items.filter((item) => selection.ids.has(item.id))
  const hasChats = all.some((item) => item.kind === 'chat')
  const hasFiles = all.some((item) => item.kind !== 'chat')

  useEffect(() => setSelection((current) => pruneSelection(current, order)), [order])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Restores and deletions change the sidebar, chat list, and Files views as well as the trash.
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: trashQueryKey(userId) }),
    queryClient.invalidateQueries({ queryKey: ['chats', userId] }),
    queryClient.invalidateQueries({ queryKey: ['files', userId] }),
    queryClient.invalidateQueries({ queryKey: ['folders', userId] }),
  ])

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (cause) {
      show({ message: filesErrorMessage(cause), tone: 'error' })
    } finally {
      await refresh()
    }
  }

  const forgetChats = (targets: readonly TrashItem[]) => {
    const chatIds = targets.filter((item) => item.kind === 'chat').map((item) => item.id)
    if (userId && chatIds.length) void clearLocalChats(userId, chatIds).catch(() => undefined)
  }

  const restore = (targets = selectedItems) => run(async () => {
    if (!targets.length) return
    setSelection(EMPTY_SELECTION)
    const restored = await restoreTrashItems(targets.map((item) => item.id))
    show({
      message: count(targets, (name) => uit`Restored "${name}"`, (total) => uit`Restored ${total} items`),
      undo: async () => {
        try {
          await retrashItems(restored.map((node) => node.id))
        } finally {
          await refresh()
        }
      },
    })
  })

  const confirmDeletion = () => run(async () => {
    const target = pending
    setPending(null)
    if (!target) return
    setSelection(EMPTY_SELECTION)
    if (target.kind === 'selection') {
      await deleteTrashItems(target.items.map((item) => item.id))
      forgetChats(target.items)
      show({ message: count(target.items, (name) => uit`Deleted "${name}" forever`, (total) => uit`Deleted ${total} items forever`) })
      return
    }
    await emptyTrash()
    forgetChats(all)
    show({ message: ui("Emptied the trash") })
  })

  const handleKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditableTarget(event.target) || pending || menu) return
    const mod = hasPrimaryModifier(event)
    if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection(selectAll(order)); return }
    if (event.key === 'Escape') { setSelection(EMPTY_SELECTION); return }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItems.length) {
      event.preventDefault()
      setPending({ kind: 'selection', items: selectedItems })
    }
  }
  const handleKeyRef = useRef(handleKey)
  handleKeyRef.current = handleKey
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const openMenu = (event: MouseEvent, item: TrashItem | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (item && !selection.ids.has(item.id)) setSelection(selectOnly(item.id))
    if (!item) setSelection(EMPTY_SELECTION)
    setMenu({ x: event.clientX, y: event.clientY })
  }

  const listing = trash.data
  const emptyMessage = filter === 'chats' ? ui("No chats in the trash") : filter === 'files' ? ui("No files in the trash") : ui("The trash is empty")

  return (
    // Handlers sit on the scroll area so clicks in the empty space below the list count too.
    <ScrollArea
      className="h-full"
      onClick={(event) => {
        // Menus and dialogs render in portals; React still bubbles their events up to here.
        if (!event.currentTarget.contains(event.target as Node)) return
        if (!(event.target as Element).closest('[data-file-id], button, a, [role="toolbar"], [role="tablist"], [data-slot="scroll-area-scrollbar"]')) setSelection(EMPTY_SELECTION)
      }}
      onContextMenu={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return
        if (!(event.target as Element).closest('[data-file-id], [data-slot="scroll-area-scrollbar"]') && items.length) openMenu(event, null)
      }}
    >
      <div className="mobile-page-content mx-auto min-h-full max-w-6xl space-y-4 px-6 py-8">
        <div className="@container flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-tight">{ui("Trash")}</h1>
          {/* With room, the selection bar floats left of Empty trash so nothing moves; in a narrow header
              it takes the button's place instead of wrapping. */}
          <div className="relative flex min-h-8 items-center gap-2">
            {selectedItems.length > 0 && (
              <TooltipProvider delayDuration={250}>
                <div role="toolbar" aria-label={ui("Selection")} className="flex h-8 items-center gap-0.5 rounded-lg border bg-muted px-0.5 @min-[36rem]:absolute @min-[36rem]:top-0 @min-[36rem]:right-full @min-[36rem]:mr-2">
                  <SelectionAction label={ui("Clear selection")} onClick={() => setSelection(EMPTY_SELECTION)}><X /></SelectionAction>
                  <span className="px-1.5 text-sm font-medium whitespace-nowrap tabular-nums">{selectedItems.length === 1 ? ui("1 selected") : uit`${selectedItems.length} selected`}</span>
                  <SelectionAction label={ui("Restore")} onClick={() => void restore()}><RotateCcw /></SelectionAction>
                  <SelectionAction label={ui("Delete forever")} destructive onClick={() => setPending({ kind: 'selection', items: selectedItems })}><Trash2 /></SelectionAction>
                </div>
              </TooltipProvider>
            )}
            <Button variant="outline" size="sm" className={cn(selectedItems.length > 0 && '@max-[36rem]:hidden')} disabled={!all.length} onClick={() => setPending({ kind: 'all' })}>
              <Trash2 /> {ui("Empty trash")}
            </Button>
          </div>
        </div>
        {listing && (
          <p className="-mt-2 text-sm text-muted-foreground">
            {trashRetentionSummary(listing.retention, listing.files)}
            {listing.files && ` ${ui("Files in the trash still count toward your storage.")}`}
            {' '}
            <button type="button" className="cursor-pointer font-medium text-foreground underline-offset-4 hover:underline" onClick={() => openSettings('trash')}>
              {ui("Change retention")}
            </button>
          </p>
        )}

        {hasChats && hasFiles && (
          <Tabs value={filter} onValueChange={(value) => setFilter(value as TrashFilter)}>
            <TabsList>
              <TabsTrigger value="all" className="px-3">{ui("All")}</TabsTrigger>
              <TabsTrigger value="chats" className="px-3">{ui("Chats")}</TabsTrigger>
              <TabsTrigger value="files" className="px-3">{listing?.files ? ui("Files") : ui("Folders")}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {trash.isPending ? (
          <div className="grid h-48 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : trash.isError ? (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            <p>{filesErrorMessage(trash.error)}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void trash.refetch()}>{ui("Try again")}</Button>
          </div>
        ) : !items.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div role="listbox" aria-multiselectable aria-label={ui("Trash")} className="divide-y overflow-hidden rounded-xl border">
            {items.map((item) => {
              const selected = selection.ids.has(item.id)
              const trashedTs = Date.parse(item.trashedAt)
              return (
                <div
                  key={item.id}
                  data-file-id={item.id}
                  role="option"
                  aria-selected={selected}
                  onClick={(event) => setSelection(clickSelect(selection, order, item.id, { toggle: hasPrimaryModifier(event), range: event.shiftKey }))}
                  onContextMenu={(event) => openMenu(event, item)}
                  className={cn('flex cursor-default items-center gap-3 px-3 py-2 select-none hover:bg-accent/50', selected && 'bg-sky-500/15 shadow-[inset_3px_0_0_var(--color-sky-500)] hover:bg-sky-500/20 dark:bg-sky-400/15')}
                >
                  <FileNodeIcon node={item} className="size-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span title={formatDateTime(trashedTs)}>{uit`Trashed ${timeAgo(trashedTs)}`}</span>
                      {' · '}
                      <span title={item.purgeAt ? formatDateTime(Date.parse(item.purgeAt)) : undefined}>{trashDeletesLabel(item.purgeAt, now)}</span>
                      {item.kind === 'blob' ? ` · ${formatBytes(item.sizeBytes)}` : ''}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); void restore([item]) }}>
                    <RotateCcw /> <span className="hidden sm:inline">{ui("Restore")}</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={uit`Delete ${item.name} forever`} onClick={(event) => { event.stopPropagation(); setPending({ kind: 'selection', items: [item] }) }}>
                    <Trash2 />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <FileContextMenu point={menu} onClose={() => setMenu(null)}>
        {selectedItems.length > 0 ? (
          <>
            {selectedItems.length > 1 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{uit`${selectedItems.length} items selected`}</DropdownMenuLabel>}
            <DropdownMenuItem onSelect={() => void restore()}><RotateCcw /> {ui("Restore")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setPending({ kind: 'selection', items: selectedItems })}>
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
                ? (pending.items.length === 1
                  ? (pending.items[0]!.kind === 'folder'
                    ? uit`"${pending.items[0]!.name}" and everything inside it will be permanently deleted. This cannot be undone.`
                    : uit`"${pending.items[0]!.name}" will be permanently deleted. This cannot be undone.`)
                  : uit`${pending.items.length} items and everything inside them will be permanently deleted. This cannot be undone.`)
                : ui("Everything in the trash will be permanently deleted. This cannot be undone.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{ui("Cancel")}</Button>
            <Button variant="destructive" onClick={() => void confirmDeletion()}>{ui("Delete forever")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
