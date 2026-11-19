import { useState } from 'react'
import type { ComputerChange, ComputerChangesItem } from '@pulpo/contracts'
import { Eye, Laptop } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui, uit } from '@/i18n/ui'
import { computerBridge, computerChangeIsDone, computerChangeNeedsReview, computerFolderName, useComputerChanges } from './bridge'
import { ComputerChangesDialog } from './ComputerChangesDialog'

/** What the reply did, from its own counts: all a client without the changes can say. */
function itemSummary(item: ComputerChangesItem): string | null {
  const parts: string[] = []
  if (item.suggested > 0) {
    parts.push(item.suggested === 1
      ? ui("Suggested 1 change on your computer")
      : ui("Suggested {{count}} changes on your computer", { count: item.suggested }))
  }
  if (item.applied > 0) {
    parts.push(item.applied === 1
      ? ui("Changed 1 file on your computer")
      : ui("Changed {{count}} files on your computer", { count: item.applied }))
  }
  return parts.length ? parts.join(' · ') : null
}

function changesSummary(changes: ComputerChange[], folder: string): string {
  const review = changes.filter(computerChangeNeedsReview).length
  if (review) {
    return review === 1
      ? ui("1 suggested change in {{folder}}", { folder })
      : ui("{{count}} suggested changes in {{folder}}", { count: review, folder })
  }
  const done = changes.filter(computerChangeIsDone).length
  if (done) {
    return done === 1
      ? ui("Changed 1 file in {{folder}}", { folder })
      : ui("Changed {{count}} files in {{folder}}", { count: done, folder })
  }
  return changes.length === 1 ? ui("Reviewed 1 suggested change") : uit`Reviewed ${changes.length} suggested changes`
}

const barClass = 'mt-2 min-w-0 rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground'

/**
 * What a reply changed, or suggested changing, in a folder on the user's computer. The changes
 * never leave that computer, so only the desktop app that holds the session can list and review
 * them; anywhere else the reply's counts are shown as a plain line.
 */
export function ComputerChangesBar({ item }: { item: ComputerChangesItem }) {
  const [bridge] = useState(computerBridge)
  const { changes, refresh } = useComputerChanges(bridge, item.session_id)
  const [reviewing, setReviewing] = useState(false)

  if (bridge && changes === null) return null
  if (!bridge || !changes?.length) {
    const summary = itemSummary(item)
    return summary ? (
      <div className={barClass} data-computer-changes={item.session_id}>
        <div className="flex min-w-0 items-center gap-1">
          <Laptop className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        </div>
      </div>
    ) : null
  }

  const folderPath = changes[0]!.folder
  const review = changes.some(computerChangeNeedsReview)
  return (
    <div className={barClass} data-computer-changes={item.session_id}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Laptop className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={folderPath}>{changesSummary(changes, computerFolderName(folderPath))}</span>
        {review && (
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setReviewing(true)}>
            <Eye /> {ui("Review")}
          </Button>
        )}
      </div>
      {reviewing && (
        <ComputerChangesDialog
          bridge={bridge}
          changes={changes}
          onChanged={refresh}
          onClose={() => setReviewing(false)}
        />
      )}
    </div>
  )
}
