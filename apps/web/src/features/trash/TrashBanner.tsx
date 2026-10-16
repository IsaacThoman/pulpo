import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsDialog } from '@/components/settings/settings-dialog'
import { ui } from '@/i18n/ui'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { trashDeletesLabel, trashRetentionSummary } from './labels'
import type { TrashView } from './use-trash-view'

/**
 * Under the trash folder's header: what happens to items in the trash, or, in a trashed folder,
 * when it goes and a way to bring the whole folder back.
 */
export function TrashBanner({ view, now, onRestoreFolder, className }: {
  view: TrashView
  now: number
  onRestoreFolder: () => void
  className?: string
}) {
  const { openSettings } = useSettingsDialog()
  const { folder } = view
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-1.5 text-sm text-muted-foreground', className)}>
      {folder ? (
        <>
          <span className="min-w-0 flex-1">
            {ui("This folder is in the trash.")}{' '}
            <span title={folder.purgeAt ? formatDateTime(Date.parse(folder.purgeAt)) : undefined}>{trashDeletesLabel(folder.purgeAt, now)}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={onRestoreFolder}><RotateCcw /> {ui("Restore folder")}</Button>
        </>
      ) : (
        <span className="min-w-0 flex-1">
          {trashRetentionSummary(view.retention, view.files)}
          {view.files && ` ${ui("Files in the trash still count toward your storage.")}`}
          {' '}
          <button type="button" className="cursor-pointer font-medium text-foreground underline-offset-4 hover:underline" onClick={() => openSettings('trash')}>
            {ui("Change retention")}
          </button>
        </span>
      )}
    </div>
  )
}
