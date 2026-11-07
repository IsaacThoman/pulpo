import { useEffect, useState, type FormEvent } from 'react'
import type { FindOptions, SheetView } from '@pulpo/client-core/office/sheets/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'

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
    view.focus()
  }
  const cell = view.getState().selectionLabel.split(':')[0]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
      <DialogContent className="sm:max-w-md">
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
