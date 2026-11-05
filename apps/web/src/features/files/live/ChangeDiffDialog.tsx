import { Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FileChangeSummary } from '@pulpo/contracts'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { fetchChangeContent, fileChangesQueryKey } from '../api'
import { filesErrorMessage } from '../file-display'
import { liveDiffFor } from './registry'

function saveVersion(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Splits "Report.docx" into "Report" and ".docx", so versions can be saved side by side. */
function versionName(name: string, label: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${label})${name.slice(dot)}` : `${name} (${label})`
}

/**
 * What an agent's change to a live document changes: the version it started from against the
 * one it wrote or proposes, through the format's own diff.
 */
export function ChangeDiffDialog({ change, responseId, onClose }: { change: FileChangeSummary; responseId: string; onClose: () => void }) {
  const userId = useAuth((state) => state.user?.id)
  const versions = useQuery({
    queryKey: [...fileChangesQueryKey(userId, responseId), 'content', change.id],
    queryFn: async () => {
      const [before, after] = await Promise.all([fetchChangeContent(change.id, 'before'), fetchChangeContent(change.id, 'after')])
      return { before, after }
    },
    staleTime: Infinity,
  })
  const Diff = liveDiffFor(change.format)
  const pending = change.mode === 'suggest' && change.status === 'pending'
  const loading = <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{uit`Changes to ${change.name}`}</DialogTitle>
          <DialogDescription>
            {pending ? ui("What accepting the agent's suggestion would change.") : ui("What the agent changed.")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions.isPending ? loading : versions.isError ? (
            <p role="alert" className="text-sm text-destructive">{filesErrorMessage(versions.error)}</p>
          ) : (
            <Suspense fallback={loading}>
              <Diff name={change.name} before={versions.data.before} after={versions.data.after} className="max-h-[60dvh]" />
            </Suspense>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!versions.data} onClick={() => versions.data && saveVersion(versions.data.before, versionName(change.name, ui("before")))}>
              <Download /> {ui("Earlier version")}
            </Button>
            <Button variant="outline" size="sm" disabled={!versions.data} onClick={() => versions.data && saveVersion(versions.data.after, versionName(change.name, pending ? ui("suggested") : ui("after")))}>
              <Download /> {pending ? ui("Suggested version") : ui("New version")}
            </Button>
          </div>
          <Button onClick={onClose}>{ui("Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
