import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ComputerChange, ComputerChangeDetail, DesktopComputerApi } from '@pulpo/contracts'
import { AlertTriangle, Check, FilePenLine, FilePlus, FolderInput, FolderPlus, Loader2, Trash2, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MarkdownDiff } from '@/features/files/MarkdownDiff'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { computerChangeNeedsReview, computerPathTail } from './bridge'

const kindIcons: Record<ComputerChange['kind'], LucideIcon> = {
  create: FilePlus,
  update: FilePenLine,
  mkdir: FolderPlus,
  move: FolderInput,
  remove: Trash2,
}

function kindLabel(kind: ComputerChange['kind']): string {
  switch (kind) {
    case 'create': return ui("new")
    case 'update': return ui("edited")
    case 'mkdir': return ui("new folder")
    case 'move': return ui("moved")
    case 'remove': return ui("removed")
  }
}

function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground', className)}>{children}</p>
}

/** The selected change's contents, loaded from the desktop app when it is selected or decided. */
function ChangeBody({ bridge, change }: { bridge: DesktopComputerApi; change: ComputerChange }) {
  const key = `${change.id}:${change.status}`
  const [detail, setDetail] = useState<{ key: string; value: ComputerChangeDetail | null } | null>(null)
  const needsText = change.kind === 'create' || change.kind === 'update'
  useEffect(() => {
    if (!needsText) return
    let live = true
    void bridge.changes.get(change.id)
      .then((value) => { if (live) setDetail({ key, value }) })
      .catch(() => { if (live) setDetail({ key, value: null }) })
    return () => { live = false }
  }, [bridge, change.id, key, needsText])

  if (change.kind === 'mkdir') return <Note>{ui("Creates this folder.")}</Note>
  if (change.kind === 'move') return <Note>{ui("Moves it to {{path}}.", { path: change.to ?? '' })}</Note>
  if (change.kind === 'remove') return <Note>{ui("Moves it to the trash.")}</Note>
  if (detail?.key !== key) {
    return <div className="flex justify-center p-6 text-muted-foreground"><Loader2 aria-label={ui("Loading…")} className="size-4 animate-spin" /></div>
  }
  const value = detail.value
  if (!value) return <Note>{ui("This change is no longer available.")}</Note>
  if (value.binary || value.after === null) {
    return <Note>{change.kind === 'create' ? ui("New file. It isn't text or is too large to show.") : ui("This file isn't text or is too large to show.")}</Note>
  }
  if (change.kind === 'create' || value.before === null) {
    return (
      <div className="space-y-2">
        <Note className="p-2 text-xs">{ui("New file")}</Note>
        <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs leading-5">{value.after}</pre>
      </div>
    )
  }
  return <MarkdownDiff before={value.before} after={value.after} className="max-h-[50dvh]" />
}

/**
 * The review of a reply's suggested changes to a folder on this computer: pick a change to see
 * what it does, then accept or reject it, or all of them at once. Accepting a file that changed
 * on disk since the suggestion turns it into a conflict, which only an explicit overwrite applies.
 */
export function ComputerChangesDialog({ bridge, changes, onChanged, onClose }: {
  bridge: DesktopComputerApi
  changes: ComputerChange[]
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const reviewable = changes.filter(computerChangeNeedsReview)
  const [selectedId, setSelectedId] = useState<string | null>(reviewable[0]?.id ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = reviewable.find((change) => change.id === selectedId) ?? reviewable[0]
  const empty = reviewable.length === 0

  useEffect(() => {
    if (empty && !busy) onClose()
  }, [busy, empty, onClose])

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch {
      setError(ui("Something went wrong"))
    } finally {
      await onChanged()
      setBusy(null)
    }
  }
  /** Decides one change; once it leaves the list, its neighbour is selected. A conflict stays. */
  const decide = (change: ComputerChange, key: string, action: () => Promise<ComputerChange[]>) => run(key, async () => {
    const result = await action()
    if (result.some((entry) => entry.id === change.id && computerChangeNeedsReview(entry))) return
    const index = reviewable.findIndex((entry) => entry.id === change.id)
    const next = reviewable[index + 1] ?? reviewable[index - 1]
    if (next) setSelectedId(next.id)
  })
  const pendingIds = reviewable.filter((change) => change.status === 'pending').map((change) => change.id)
  const allIds = reviewable.map((change) => change.id)

  const moveSelection = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = reviewable.findIndex((change) => change.id === selected?.id)
    const next = reviewable[Math.max(0, Math.min(reviewable.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    setSelectedId(next.id)
    Array.from(listRef.current?.querySelectorAll('button') ?? []).find((button) => button.dataset.changeId === next.id)?.focus()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{ui("Suggested changes")}</DialogTitle>
          <DialogDescription className="truncate" title={changes[0]?.folder}>{changes[0] ? computerPathTail(changes[0].folder) : null}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <ul ref={listRef} aria-label={ui("Suggested changes")} onKeyDown={moveSelection} className="max-h-40 min-h-0 space-y-0.5 overflow-y-auto sm:max-h-none">
            {reviewable.map((change) => {
              const Icon = kindIcons[change.kind]
              const current = change.id === selected?.id
              return (
                <li key={change.id}>
                  <button
                    type="button"
                    data-change-id={change.id}
                    aria-current={current ? 'true' : undefined}
                    tabIndex={current ? 0 : -1}
                    title={change.kind === 'move' && change.to ? `${change.path} → ${change.to}` : change.path}
                    onClick={() => setSelectedId(change.id)}
                    className={cn(
                      'flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
                      current && 'bg-muted font-medium',
                    )}
                  >
                    {change.status === 'conflict'
                      ? <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      : <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{change.path}</span>
                    <span className="shrink-0 rounded border border-dashed !border-sky-600/50 px-1 text-[11px] leading-4 font-normal text-sky-700 dark:!border-sky-400/50 dark:text-sky-300">{kindLabel(change.kind)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected && (
            <section aria-label={selected.path} className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={selected.path}>{selected.path}</span>
                {selected.status === 'conflict' ? (
                  <Button size="sm" variant="outline" className="h-7" disabled={Boolean(busy)} onClick={() => void decide(selected, `overwrite:${selected.id}`, () => bridge.changes.accept([selected.id], { overwrite: true }))}>
                    {busy === `overwrite:${selected.id}` ? <Loader2 className="animate-spin" /> : <Check />} {selected.kind === 'remove' ? ui("Remove anyway") : ui("Overwrite")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7" disabled={Boolean(busy)} onClick={() => void decide(selected, `accept:${selected.id}`, () => bridge.changes.accept([selected.id]))}>
                    {busy === `accept:${selected.id}` ? <Loader2 className="animate-spin" /> : <Check className="text-emerald-600 dark:text-emerald-400" />} {ui("Accept")}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7" disabled={Boolean(busy)} onClick={() => void decide(selected, `reject:${selected.id}`, () => bridge.changes.reject([selected.id]))}>
                  {busy === `reject:${selected.id}` ? <Loader2 className="animate-spin" /> : <X className="text-red-600 dark:text-red-400" />} {ui("Reject")}
                </Button>
              </div>
              {selected.status === 'conflict' && (
                <p role="status" className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {/* A removal conflicts only when the folder it names has been given something since. */}
                  {selected.kind === 'remove' ? ui("This folder is no longer empty.") : ui("This file changed on your computer since the suggestion.")}
                </p>
              )}
              <ChangeBody bridge={bridge} change={selected} />
            </section>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={Boolean(busy) || empty} onClick={() => void run('reject-all', () => bridge.changes.reject(allIds))}>
            {busy === 'reject-all' ? <Loader2 className="animate-spin" /> : <X />} {ui("Reject all")}
          </Button>
          <Button disabled={Boolean(busy) || pendingIds.length === 0} onClick={() => void run('accept-all', () => bridge.changes.accept(pendingIds))}>
            {busy === 'accept-all' ? <Loader2 className="animate-spin" /> : <Check />} {ui("Accept all")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
