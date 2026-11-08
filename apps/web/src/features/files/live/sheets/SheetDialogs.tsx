import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { FindOptions, SheetRequest, SheetView } from '@pulpo/client-core/office/sheets/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'
import { focusGridOnClose } from './dialog-focus'
import { lineLabels, lineSpan } from './selection-labels'

/** Adds, edits, or removes the note on the active cell. */
export function NoteDialog({ view, open, onOpenChange }: { view: SheetView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) setText(view.getState().activeNote?.text ?? '')
  }, [open, view])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    view.setNote(text.trim() ? { author: view.getState().activeNote?.author ?? view.options.user.name, text } : undefined)
    onOpenChange(false)
  }
  const cell = view.getState().selectionLabel.split(':')[0]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={focusGridOnClose(view)}>
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{ui("Note on {{cell}}", { cell: cell ?? '' })}</DialogTitle>
            <DialogDescription>{ui("Notes show when you point at the cell. Leave it empty to remove the note.")}</DialogDescription>
          </DialogHeader>
          <Textarea aria-label={ui("Note")} value={text} onChange={(event) => setText(event.target.value)} rows={5} autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Find and replace across the sheet or the whole workbook. */
export function FindDialog({ view, open, onOpenChange }: { view: SheetView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState<FindOptions>({})
  const [index, setIndex] = useState(-1)
  const [status, setStatus] = useState('')
  const readOnly = view.getState().readOnly
  const matches = () => view.find(query, options)

  const findNext = () => {
    const found = matches()
    if (!found.length) {
      setStatus(ui("No matches"))
      return
    }
    const next = (index + 1) % found.length
    setIndex(next)
    const match = found[next]!
    if (match.sheetId !== view.sheetId) view.setActiveSheet(match.sheetId)
    view.select({ top: match.row, left: match.col, bottom: match.row, right: match.col })
    setStatus(ui("{{current}} of {{total}}", { current: next + 1, total: found.length }))
  }
  const replaceOne = () => {
    const found = matches()
    const match = found[Math.max(0, index)]
    if (!match) return findNext()
    const changed = view.replace(query, replacement, options, match)
    setStatus(changed ? ui("Replaced 1 cell") : ui("No matches"))
    findNext()
  }
  const replaceAll = () => {
    const changed = view.replace(query, replacement, options)
    setStatus(changed === 1 ? ui("Replaced 1 cell") : ui("Replaced {{count}} cells", { count: changed }))
    setIndex(-1)
  }
  const check = (key: keyof FindOptions, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!options[key]} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} />
      {label}
    </label>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={focusGridOnClose(view)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            findNext()
          }}
        >
          <DialogHeader>
            <DialogTitle>{ui("Find and replace")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sheet-find">{ui("Find")}</Label>
            <Input id="sheet-find" value={query} onChange={(event) => { setQuery(event.target.value); setIndex(-1); setStatus('') }} autoFocus />
          </div>
          {!readOnly && (
            <div className="space-y-2">
              <Label htmlFor="sheet-replace">{ui("Replace with")}</Label>
              <Input id="sheet-replace" value={replacement} onChange={(event) => setReplacement(event.target.value)} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {check('matchCase', ui("Match case"))}
            {check('entireCell', ui("Match entire cell"))}
            {check('formulas', ui("Search in formulas"))}
            {check('allSheets', ui("All sheets"))}
          </div>
          <p role="status" className="min-h-5 text-sm text-muted-foreground">{status}</p>
          <DialogFooter className="gap-2">
            {!readOnly && <Button type="button" variant="outline" onClick={replaceAll} disabled={!query}>{ui("Replace all")}</Button>}
            {!readOnly && <Button type="button" variant="outline" onClick={replaceOne} disabled={!query}>{ui("Replace")}</Button>}
            <Button type="submit" disabled={!query}>{ui("Find next")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type ValidationRequest = Extract<SheetRequest, { request: 'validation' }>

/**
 * Excel's prompt for a value that breaks a warning or information rule: "Continue?" with Yes, No
 * and Cancel (warning), or OK and Cancel (information). The edit waits for the answer; closing the
 * prompt any other way cancels the edit, as Escape does in Excel. The answer is given once the
 * prompt has gone, so the grid gets the focus back.
 */
export function ValidationPrompt({ request, onDone }: { request: ValidationRequest | undefined; onDone: () => void }) {
  const answer = useRef<'accept' | 'retry' | 'cancel'>('cancel')
  const shown = useRef<ValidationRequest | undefined>(undefined)
  if (request && shown.current !== request) {
    shown.current = request
    answer.current = 'cancel'
  }
  const pick = (value: 'accept' | 'retry' | 'cancel') => {
    answer.current = value
    onDone()
  }
  const warning = request?.style !== 'information'
  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) pick('cancel') }}>
      <DialogContent
        role="alertdialog"
        className="sm:max-w-md"
        showCloseButton={false}
        data-sheet-validation-prompt=""
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const settled = shown.current
          shown.current = undefined
          settled?.respond(answer.current)
        }}
      >
        <DialogHeader>
          <DialogTitle>{request?.title || ui("Invalid data")}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">{request?.message}</DialogDescription>
        </DialogHeader>
        {warning && <p className="text-sm">{ui("Continue?")}</p>}
        <DialogFooter className="gap-2">
          {warning ? (
            <>
              <Button type="button" variant="outline" onClick={() => pick('cancel')}>{ui("Cancel")}</Button>
              <Button type="button" variant="outline" onClick={() => pick('retry')}>{ui("No")}</Button>
              <Button type="button" autoFocus onClick={() => pick('accept')}>{ui("Yes")}</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => pick('cancel')}>{ui("Cancel")}</Button>
              <Button type="button" autoFocus onClick={() => pick('accept')}>{ui("OK")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Ctrl+Alt+- (Excel's Ctrl+-) with cells selected: delete their whole rows or whole columns, as
 * Excel's Delete dialog offers (cells can't shift on their own in a shared sheet).
 */
export function DeleteLinesDialog({ view, open, onOpenChange }: { view: SheetView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [kind, setKind] = useState<'row' | 'col'>('row')
  const id = useId()
  useEffect(() => {
    if (open) setKind('row')
  }, [open])
  const rows = lineSpan(view, 'row')
  const cols = lineSpan(view, 'col')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onOpenChange(false)
    view.deleteLines(kind)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onCloseAutoFocus={focusGridOnClose(view)}>
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{ui("Delete")}</DialogTitle>
            <DialogDescription>{ui("Delete the whole rows or the whole columns of the selected cells.")}</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="sr-only">{ui("Delete")}</legend>
            {([['row', lineLabels.delete(rows)], ['col', lineLabels.delete(cols)]] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${id}-kind`} value={value} checked={kind === value} onChange={() => setKind(value)} autoFocus={value === 'row'} />
                {label}
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Delete")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Google's "Resize rows" / "Resize columns": a size in pixels for every selected line, or fit to data. */
export function ResizeLinesDialog({ view, kind, onOpenChange }: { view: SheetView; kind: 'row' | 'col' | undefined; onOpenChange: (open: boolean) => void }) {
  const [mode, setMode] = useState<'size' | 'fit'>('size')
  const [size, setSize] = useState('')
  const [error, setError] = useState<string>()
  const id = useId()
  useEffect(() => {
    if (!kind) return
    const range = view.selection.ranges[view.selection.ranges.length - 1]!
    const first = kind === 'row' ? range.top : range.left
    setMode('size')
    setSize(String(Math.round(kind === 'row' ? view.rows.size(first) : view.cols.size(first))))
    setError(undefined)
  }, [kind, view])
  const span = kind ? lineSpan(view, kind) : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!kind) return
    if (mode === 'fit') {
      onOpenChange(false)
      view.autoFit(kind)
      return
    }
    const pixels = Number(size.trim())
    if (!Number.isFinite(pixels) || pixels < 2 || pixels > 2000) {
      setError(ui("Enter a size from 2 to 2000 pixels."))
      return
    }
    onOpenChange(false)
    view.resizeLines(kind, Math.round(pixels))
  }
  const sizeLabel = kind === 'row' ? ui("Row height in pixels") : ui("Column width in pixels")
  return (
    <Dialog open={!!kind} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onCloseAutoFocus={focusGridOnClose(view)}>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{span ? lineLabels.resizeTitle(span) : ''}</DialogTitle>
            <DialogDescription>{kind === 'row' ? ui("Set the height of the selected rows, or fit them to their content.") : ui("Set the width of the selected columns, or fit them to their content.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${id}-mode`} checked={mode === 'size'} onChange={() => setMode('size')} />
              {kind === 'row' ? ui("Specify row height") : ui("Specify column width")}
            </label>
            <div className="space-y-1 pl-6">
              <Input
                id={`${id}-size`}
                aria-label={sizeLabel}
                inputMode="numeric"
                value={size}
                disabled={mode !== 'size'}
                onChange={(event) => { setSize(event.target.value); setError(undefined) }}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                className="w-28"
                autoFocus
              />
              {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${id}-mode`} checked={mode === 'fit'} onChange={() => setMode('fit')} />
              {ui("Fit to data")}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("OK")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
