import type { FileConversionPreview } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'
import { MarkdownDiff } from './MarkdownDiff'

/** Shown before editing an uploaded Markdown file whose text the editor would reformat. */
export function MarkdownConversionDialog({ preview, busy, onCancel, onConfirm }: {
  preview: FileConversionPreview | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{ui("Editing will reformat this file")}</DialogTitle>
          <DialogDescription>
            {ui("The editor saves Markdown in its own style. Formatting it doesn't support, such as raw HTML or footnotes, is simplified. Download a copy first if you need the original exactly.")}
          </DialogDescription>
        </DialogHeader>
        {preview && <MarkdownDiff before={preview.original} after={preview.converted} className="min-h-0 flex-1" />}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>{ui("Cancel")}</Button>
          <Button disabled={busy} onClick={onConfirm}>{ui("Convert and edit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
