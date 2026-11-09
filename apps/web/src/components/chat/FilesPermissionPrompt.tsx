import { useState } from 'react'
import { filesPermissionStepLabel, useFilesPermissionPending } from './files-permission'
import type { FilesPermissionDecision, FilesPermissionItem } from '@pulpo/contracts'
import { ChevronDown, FolderCheck, FolderClock, FolderSearch, FolderX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui, uit } from '@/i18n/ui'
import { useChat } from '@/stores/chat'

export function FilesPermissionIcon({ item, pending, className }: { item: FilesPermissionItem; pending: boolean; className?: string }) {
  const Icon = item.status === 'allowed' || item.status === 'always_allowed'
    ? FolderCheck
    : item.status === 'denied' ? FolderX
    : pending ? FolderSearch : FolderClock
  return <Icon className={className} aria-hidden="true" />
}

export function FilesPermissionStepRow({ item, live }: { item: FilesPermissionItem; live: boolean }) {
  const pending = useFilesPermissionPending(item, live)
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <FilesPermissionIcon item={item} pending={pending} className="size-3 shrink-0" />
      <span className="min-w-0 flex-1">{filesPermissionStepLabel(item, pending)}</span>
    </div>
  )
}

function requestedPlace(item: FilesPermissionItem): string {
  if (!item.path) return item.command === 'ls' || item.command === 'tree' ? ui("It asked to list My files.") : ui("It asked to search My files.")
  return uit`It asked about “${item.path}”.`
}

/**
 * Asks the user to let a running Agent reply browse all of their Files. The reply waits for the
 * answer (and carries on without if it never comes).
 */
export function FilesPermissionPrompt({ responseId, item }: { responseId: string; item: FilesPermissionItem }) {
  const answerFilesPermission = useChat((state) => state.answerFilesPermission)
  const [pending, setPending] = useState<FilesPermissionDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answer = (decision: FilesPermissionDecision) => {
    setPending(decision)
    setError(null)
    void answerFilesPermission(responseId, item.id, decision).catch((reason: unknown) => {
      setPending(null)
      setError(reason instanceof Error ? reason.message : ui("Couldn't send your answer. Try again."))
    })
  }
  return (
    <section aria-labelledby={`${item.id}:title`} className="space-y-2.5 rounded-xl border bg-muted/30 p-3">
      <div className="flex min-w-0 gap-2.5">
        <FolderSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <h3 id={`${item.id}:title`} className="text-sm font-medium">{ui("Pulpo Agent wants to look through your Files")}</h3>
          <p className="text-xs text-muted-foreground">
            {requestedPlace(item)} {ui("If you allow it, it can read all of your Files. Changes to items you didn't mention wait for your review.")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6.5">
        <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => answer('deny')}>
          {pending === 'deny' ? ui("Denying…") : ui("Deny")}
        </Button>
        <div className="flex">
          <Button size="sm" className="rounded-r-none" disabled={pending !== null} onClick={() => answer('allow_chat')}>
            {pending === 'allow_chat' ? ui("Allowing…") : ui("Allow for this chat")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-2" disabled={pending !== null} aria-label={ui("More ways to allow")}>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem className="flex-col items-start gap-0.5" onSelect={() => answer('allow_always')}>
                <span>{pending === 'allow_always' ? ui("Allowing…") : ui("Always allow reading Files")}</span>
                <span className="text-xs text-muted-foreground">{ui("Stop asking in every chat. You can turn asking back on in Settings.")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error && <p role="alert" className="pl-6.5 text-xs text-destructive">{error}</p>}
    </section>
  )
}
