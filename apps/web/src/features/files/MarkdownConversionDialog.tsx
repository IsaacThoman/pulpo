import { useMemo } from 'react'
import type { FileConversionPreview } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { diffRows, lineDiff } from './markdown-diff'

/** Shown before editing an uploaded Markdown file whose text the editor would reformat. */
export function MarkdownConversionDialog({ preview, busy, onCancel, onConfirm }: {
  preview: FileConversionPreview | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const rows = useMemo(() => {
    if (!preview) return null
    const diff = lineDiff(preview.original, preview.converted)
    return diff && diffRows(diff)
  }, [preview])
  const changedLines = rows?.filter((row) => row.kind === 'added' || row.kind === 'removed').length ?? 0

  return (
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{ui("Editing will reformat this file")}</DialogTitle>
          <DialogDescription>
            {ui("The editor saves Markdown in its own style. Formatting it doesn't support, such as raw HTML or footnotes, is simplified. Download a copy first if you need the original exactly.")}
          </DialogDescription>
        </DialogHeader>
        {rows ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/30 font-mono text-xs leading-5">
            <p className="sticky top-0 border-b bg-muted px-3 py-1.5 font-sans text-xs text-muted-foreground">
              {changedLines === 1 ? ui("1 line changes") : uit`${changedLines} lines change`}
            </p>
            {rows.map((row, index) => row.kind === 'gap' ? (
              <div key={index} className="px-3 py-0.5 text-muted-foreground/70 select-none">{uit`⋯ ${row.count} unchanged lines`}</div>
            ) : (
              <div
                key={index}
                className={cn(
                  'flex gap-2 px-3 whitespace-pre-wrap',
                  row.kind === 'removed' && 'bg-red-500/10 text-red-700 dark:text-red-300',
                  row.kind === 'added' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                )}
              >
                <span aria-hidden className="w-3 shrink-0 select-none">{row.kind === 'removed' ? '−' : row.kind === 'added' ? '+' : ' '}</span>
                <span className="min-w-0 break-all">{row.text || ' '}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{ui("This file is too long to show every change.")}</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>{ui("Cancel")}</Button>
          <Button disabled={busy} onClick={onConfirm}>{ui("Convert and edit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
