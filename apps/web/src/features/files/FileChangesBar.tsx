import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileChangeConflict, FileChangeSummary, FileChangesResponse } from '@pulpo/contracts'
import { Check, FilePenLine, Loader2, Redo2, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOpenBeside } from '@/features/side-panel/use-panel-actions'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { fetchFileChanges, fileChangesQueryKey, filesQueryKey, resolveFileChange, updateFileChanges } from './api'
import { fileChangeConflicts, fileChangeDescription, fileChangeLabel, fileConflictReason, pendingSuggestion } from './file-changes'
import { filesErrorMessage } from './file-display'
import { FileNodeIcon } from './FileNodeIcon'
import { MarkdownDiff } from './MarkdownDiff'

/** Items listed before "Show more"; one more is listed rather than hidden behind it. */
const COLLAPSED_ITEMS = 4

type Action = 'undo' | 'redo' | 'accept' | 'reject'

function summary(changes: FileChangeSummary[]): string {
  const pending = changes.filter(pendingSuggestion).length
  if (pending) return pending === 1 ? ui("1 suggested change to review") : uit`${pending} suggested changes to review`
  const writes = changes.filter((change) => change.mode === 'write')
  if (!writes.length) return changes.length === 1 ? ui("Reviewed 1 suggested change") : uit`Reviewed ${changes.length} suggested changes`
  if (writes.every((change) => change.status === 'undone')) return writes.length === 1 ? ui("Undid the change to 1 item") : uit`Undid changes to ${writes.length} items`
  return changes.length === 1 ? ui("Changed 1 item") : uit`Changed ${changes.length} items`
}

function statusWord(change: FileChangeSummary): string | null {
  switch (change.status) {
    case 'accepted': return ui("accepted")
    case 'rejected': return ui("rejected")
    case 'undone': return ui("undone")
    default: return null
  }
}

function IconAction({ label, busy, disabled, onClick, children }: { label: string; busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground disabled:cursor-default disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function ChangeRow({ change, busy, onResolve }: { change: FileChangeSummary; busy: string | null; onResolve: (action: 'accept' | 'reject') => void }) {
  const openBeside = useOpenBeside()
  const pending = pendingSuggestion(change)
  const struck = change.status === 'rejected' || change.status === 'undone'
  const status = statusWord(change)
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        disabled={!change.available}
        title={fileChangeDescription(change)}
        className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 text-foreground hover:bg-background/70 disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
        onClick={() => openBeside(change.nodeKind === 'folder' ? { kind: 'folder', id: change.nodeId } : { kind: 'file', id: change.nodeId })}
      >
        <FileNodeIcon node={{ kind: change.nodeKind, name: change.name, mimeType: change.mimeType }} className="size-3.5 shrink-0" />
        <span className={cn('truncate', struck && 'text-muted-foreground line-through')}>{change.name}</span>
      </button>
      <span className={cn(
        'shrink-0 rounded px-1 text-[11px] leading-4',
        pending ? 'border border-dashed !border-sky-600/50 text-sky-700 dark:!border-sky-400/50 dark:text-sky-300' : 'bg-background/70',
      )}>
        {fileChangeLabel(change)}
      </span>
      {status && <span className="shrink-0 text-[11px] text-muted-foreground">{status}</span>}
      {pending && change.available && (
        <span className="flex shrink-0 items-center">
          <IconAction label={uit`Accept the change to ${change.name}`} busy={busy === `accept:${change.id}`} disabled={Boolean(busy)} onClick={() => onResolve('accept')}>
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          </IconAction>
          <IconAction label={uit`Reject the change to ${change.name}`} busy={busy === `reject:${change.id}`} disabled={Boolean(busy)} onClick={() => onResolve('reject')}>
            <X className="size-3.5 text-red-600 dark:text-red-400" />
          </IconAction>
        </span>
      )}
    </li>
  )
}

/** Why an undo or redo was refused: each item that changed since, with a diff for documents. */
function ConflictDialog({ action, conflicts, changes, onClose }: {
  action: 'undo' | 'redo'
  conflicts: FileChangeConflict[]
  changes: FileChangeSummary[]
  onClose: () => void
}) {
  const openBeside = useOpenBeside()
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{action === 'undo' ? ui("These changes can't be undone") : ui("These changes can't be redone")}</DialogTitle>
          <DialogDescription>
            {action === 'undo'
              ? ui("These items changed after the agent's reply, so nothing was undone. Change them back by hand if you still want to.")
              : ui("These items changed after the undo, so nothing was redone.")}
          </DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {conflicts.map((conflict) => {
            const change = changes.find((item) => item.id === conflict.changeId)
            const kind = change?.nodeKind ?? (conflict.expected !== undefined ? 'doc' : 'blob')
            return (
              <li key={conflict.changeId} className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <FileNodeIcon node={{ kind, name: conflict.name, mimeType: change?.mimeType ?? null }} className="size-4 shrink-0" />
                  <button
                    type="button"
                    disabled={conflict.reason === 'deleted'}
                    className="min-w-0 cursor-pointer truncate font-medium hover:underline disabled:cursor-default disabled:no-underline"
                    onClick={() => openBeside(kind === 'folder' ? { kind: 'folder', id: conflict.nodeId } : { kind: 'file', id: conflict.nodeId })}
                  >
                    {conflict.name}
                  </button>
                  <span className="min-w-0 truncate text-muted-foreground">{fileConflictReason(conflict)}</span>
                </div>
                {conflict.expected !== undefined && conflict.current !== undefined && (
                  <MarkdownDiff before={conflict.expected} after={conflict.current} className="mt-2 max-h-72" />
                )}
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>{ui("OK")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What an agent reply changed in Files. Write-mode changes undo and redo together; suggestions
 * are accepted or rejected together or one by one, and documents open where theirs are reviewed.
 */
export function FileChangesBar({ responseId }: { responseId: string }) {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const queryKey = fileChangesQueryKey(userId, responseId)
  const query = useQuery({
    queryKey,
    queryFn: () => fetchFileChanges(responseId),
    enabled: Boolean(userId),
    staleTime: 5_000,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ action: 'undo' | 'redo'; conflicts: FileChangeConflict[] } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const changes = query.data?.changes ?? []
  if (!changes.length) return null

  const run = async (key: string, request: () => Promise<FileChangesResponse>, action: Action) => {
    setBusy(key)
    setError(null)
    try {
      queryClient.setQueryData(queryKey, await request())
    } catch (cause) {
      const conflicts = fileChangeConflicts(cause)
      if (conflicts && (action === 'undo' || action === 'redo')) setConflict({ action, conflicts })
      else setError(filesErrorMessage(cause))
    } finally {
      setBusy(null)
      // The items changed too: refresh listings and open views along with this list.
      void queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    }
  }
  const all = (action: Action) => void run(action, () => updateFileChanges(responseId, action), action)

  const pending = changes.some(pendingSuggestion)
  const collapsible = changes.length > COLLAPSED_ITEMS + 1
  const shown = expanded || !collapsible ? changes : changes.slice(0, COLLAPSED_ITEMS)
  const actionButton = (action: Action, label: string, icon: ReactNode) => (
    <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" disabled={Boolean(busy)} onClick={() => all(action)}>
      {busy === action ? <Loader2 className="animate-spin" /> : icon} {label}
    </Button>
  )

  return (
    <div className="mt-2 min-w-0 rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground" data-file-changes={responseId}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <FilePenLine className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{summary(changes)}</span>
        {pending && actionButton('accept', ui("Accept all"), <Check className="text-emerald-600 dark:text-emerald-400" />)}
        {pending && actionButton('reject', ui("Reject all"), <X className="text-red-600 dark:text-red-400" />)}
        {query.data?.canUndo && actionButton('undo', ui("Undo"), <Undo2 />)}
        {query.data?.canRedo && actionButton('redo', ui("Redo"), <Redo2 />)}
      </div>
      <ul className="mt-1 space-y-0.5 pl-4">
        {shown.map((change) => (
          <ChangeRow
            key={change.id}
            change={change}
            busy={busy}
            onResolve={(action) => void run(`${action}:${change.id}`, () => resolveFileChange(change.id, action), action)}
          />
        ))}
      </ul>
      {collapsible && (
        <button type="button" className="mt-0.5 ml-5 cursor-pointer rounded px-1 hover:bg-background/70 hover:text-foreground" onClick={() => setExpanded(!expanded)}>
          {expanded ? ui("Show less") : uit`Show ${changes.length - COLLAPSED_ITEMS} more`}
        </button>
      )}
      {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
      {conflict && <ConflictDialog action={conflict.action} conflicts={conflict.conflicts} changes={changes} onClose={() => setConflict(null)} />}
    </div>
  )
}
