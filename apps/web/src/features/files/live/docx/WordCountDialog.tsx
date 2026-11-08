import type { WordCount } from '@pulpo/client-core/office/docx/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { activeLocale, ui } from '@/i18n/ui'

export interface WordCounts {
  document: WordCount
  /** Null when nothing is selected. */
  selection: WordCount | null
  /** Pages in print layout; undefined in web layout, which has none. */
  pages?: number
}

/**
 * Docs' Tools ▸ Word count and Word's Word Count: pages, words, characters with and without
 * spaces, and paragraphs, for the document and the selection, with Docs' "Display word count
 * while typing" (the status bar's live count).
 */
export function WordCountDialog({ open, onOpenChange, counts, showWhileTyping, onShowWhileTypingChange, returnFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  counts: WordCounts | null
  showWhileTyping: boolean
  onShowWhileTypingChange: (show: boolean) => void
  returnFocus?: () => void
}) {
  const locale = activeLocale()
  const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString(locale)
  const columns = counts ? [
    { id: 'document', label: ui("Document"), count: counts.document, pages: counts.pages },
    ...(counts.selection ? [{ id: 'selection', label: ui("Selection"), count: counts.selection, pages: undefined }] : []),
  ] : []
  const rows: { id: string; label: string; value: (column: (typeof columns)[number]) => number | undefined }[] = [
    { id: 'pages', label: ui("Pages"), value: (column) => column.pages },
    { id: 'words', label: ui("Words"), value: (column) => column.count.words },
    { id: 'characters', label: ui("Characters"), value: (column) => column.count.charactersWithSpaces },
    { id: 'characters-no-spaces', label: ui("Characters excluding spaces"), value: (column) => column.count.characters },
    { id: 'paragraphs', label: ui("Paragraphs"), value: (column) => column.count.paragraphs },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return
          event.preventDefault()
          returnFocus()
        }}
        data-docx-word-count=""
      >
        <DialogHeader>
          <DialogTitle>{ui("Word count")}</DialogTitle>
          <DialogDescription>{counts?.selection ? ui("Counts for the whole document and for the selected text.") : ui("Counts for the whole document. Select text to count part of it.")}</DialogDescription>
        </DialogHeader>
        {counts && (
          <table className="w-full text-sm tabular-nums">
            <thead className={columns.length > 1 ? undefined : 'sr-only'}>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 text-left font-normal"><span className="sr-only">{ui("Statistic")}</span></th>
                {columns.map((column) => <th key={column.id} scope="col" className="py-1.5 pl-4 text-right font-normal">{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const values = columns.map((column) => row.value(column))
                if (values.every((value) => value === undefined)) return null
                return (
                  <tr key={row.id} className="border-b last:border-b-0" data-count={row.id}>
                    <th scope="row" className="py-2 text-left font-normal">{row.label}</th>
                    {values.map((value, index) => <td key={columns[index]!.id} className="py-2 pl-4 text-right" data-column={columns[index]!.id}>{number(value)}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={showWhileTyping} onChange={(event) => onShowWhileTypingChange(event.target.checked)} className="size-4 cursor-pointer accent-primary" />
          {ui("Display word count while typing")}
        </label>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} autoFocus>{ui("OK")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
