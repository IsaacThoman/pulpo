import type { FileNode } from '@pulpo/contracts'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { activeLocale, ui } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { fileTypeLabel } from './file-type'

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** File ▸ Details: the file's type, size, folder, and when it was created and last changed. */
export function FileDetailsDialog({ node, ancestors, open, onOpenChange, returnFocus }: {
  node: FileNode
  ancestors: readonly FileNode[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes once the dialog closes, e.g. back into the document. */
  returnFocus?: () => void
}) {
  const location = [ui("My files"), ...ancestors.map((folder) => folder.name)].join(' › ')
  const rows: [string, string][] = [
    [ui("Type"), fileTypeLabel(node)],
    [ui("Size"), formatBytes(node.sizeBytes)],
    [ui("Location"), location],
    [ui("Created"), formatDate(node.createdAt)],
    [ui("Modified"), formatDate(node.updatedAt)],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={returnFocus && ((event) => {
          event.preventDefault()
          returnFocus()
        })}
      >
        <DialogHeader>
          <DialogTitle className="break-words">{node.name}</DialogTitle>
          <DialogDescription>{ui("Details")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-file-details>
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
