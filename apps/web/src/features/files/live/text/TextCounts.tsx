import { useEffect, useState } from 'react'
import type { TextCounts, TextEditor, TextEditorState } from '@pulpo/client-core/office/text/view'
import type * as Y from 'yjs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { activeLocale, ui, uit } from '@/i18n/ui'

/** Counting waits this long after the last change; files can be megabytes long. */
const COUNT_DELAY_MS = 300

/** Files people write prose in, which show a word count as the Word editor does. */
const PROSE = /\.(txt|text|log|rst|adoc|asciidoc|org|tex|srt|vtt)$|^(readme|license|licence|changelog|authors|contributing|notice|copying)(\.[^.]*)?$/i

function isProseFile(name: string): boolean {
  return PROSE.test(name)
}

/** The document's counts, recounted a moment after it changes; null until counted, or while not wanted. */
function useDocumentCounts(editor: TextEditor | null, doc: Y.Doc, wanted: boolean): TextCounts | null {
  const [counts, setCounts] = useState<TextCounts | null>(null)
  useEffect(() => {
    if (!editor || !wanted) {
      setCounts(null)
      return
    }
    const text = doc.getText('text')
    let timer: number | undefined
    const count = () => setCounts(editor.counts('document'))
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(count, COUNT_DELAY_MS)
    }
    count()
    text.observe(later)
    return () => {
      window.clearTimeout(timer)
      text.unobserve(later)
    }
  }, [editor, doc, wanted])
  return counts
}

/** The selection's counts, a moment after it settles (dragging a selection over a long file stays smooth). */
function useSelectionCounts(editor: TextEditor | null, state: TextEditorState): TextCounts | null {
  const [counts, setCounts] = useState<TextCounts | null>(null)
  const { selected, selections, line, column } = state
  useEffect(() => {
    if (!editor || !selected) {
      setCounts(null)
      return
    }
    const timer = window.setTimeout(() => setCounts(editor.counts('selection')), selected > 100_000 ? COUNT_DELAY_MS : 50)
    return () => window.clearTimeout(timer)
  }, [editor, selected, selections, line, column])
  return counts
}

function WordCountDialog({ open, onClose, onClosed, document, selection }: { open: boolean; onClose: () => void; onClosed: () => void; document: TextCounts | null; selection: TextCounts | null }) {
  const locale = activeLocale()
  const rows: [string, (counts: TextCounts) => number][] = [
    [ui("Words"), (counts) => counts.words],
    [ui("Characters"), (counts) => counts.charactersWithSpaces],
    [ui("Characters excluding spaces"), (counts) => counts.characters],
    [ui("Lines"), (counts) => counts.lines],
  ]
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          // Back to the text, not to the status bar.
          event.preventDefault()
          onClosed()
        }}
      >
        <DialogHeader>
          <DialogTitle>{ui("Word count")}</DialogTitle>
          <DialogDescription className="sr-only">{ui("Words and characters in this file")}</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm tabular-nums" data-text-word-count>
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal" />
              {selection && <th className="py-1 text-right font-normal">{ui("Selection")}</th>}
              <th className="py-1 text-right font-normal">{ui("Document")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-t">
                <th scope="row" className="py-1.5 text-left font-normal">{label}</th>
                {selection && <td className="py-1.5 text-right">{value(selection).toLocaleString(locale)}</td>}
                <td className="py-1.5 text-right">{document ? value(document).toLocaleString(locale) : '…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The status bar's counts: lines always, words in prose files and for a selection (as "12 of 345
 * words", like Word), the number of cursors when there are several, and the Word count dialog.
 */
export function TextStatusCounts({ editor, doc, name, state, onDone }: { editor: TextEditor | null; doc: Y.Doc; name: string; state: TextEditorState; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const prose = isProseFile(name)
  const documentCounts = useDocumentCounts(editor, doc, prose || open || state.selected > 0)
  const selectionCounts = useSelectionCounts(editor, state)
  const locale = activeLocale()
  const words = selectionCounts && documentCounts
    ? uit`${selectionCounts.words.toLocaleString(locale)} of ${documentCounts.words.toLocaleString(locale)} words`
    : prose && documentCounts ? ui("{{count}} words", { count: documentCounts.words.toLocaleString(locale) }) : null
  return (
    <>
      {state.selections > 1 && <span>{uit`${state.selections.toLocaleString(locale)} selections`}</span>}
      <button
        type="button"
        className="cursor-pointer rounded px-1 hover:bg-accent hover:text-foreground"
        title={ui("Word count")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(true)}
        data-text-counts
      >
        {words && <span className="mr-3">{words}</span>}
        {state.lines === 1 ? ui("1 line") : uit`${state.lines.toLocaleString(locale)} lines`}
      </button>
      <WordCountDialog
        open={open}
        onClose={() => setOpen(false)}
        onClosed={onDone}
        document={documentCounts}
        selection={selectionCounts}
      />
    </>
  )
}
