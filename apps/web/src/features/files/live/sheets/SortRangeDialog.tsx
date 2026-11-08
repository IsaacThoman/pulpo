import { useEffect, useId, useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { columnName, rangeName, type CellRange } from '@pulpo/client-core/office/sheets'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ui } from '@/i18n/ui'
import { focusGridOnClose } from './dialog-focus'
import { guessHeader, sortArea, sortedRows } from './sort-range'

interface SortKeyDraft {
  col: number
  descending: boolean
}

/**
 * Data ▸ Sort range ▸ Advanced range sorting options: a header row, one or more sort columns,
 * each A → Z or Z → A, and case sensitivity (Excel's Sort dialog). One undo step.
 */
export function SortRangeDialog({ view, open, onOpenChange }: { view: SheetView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [area, setArea] = useState<CellRange>({ top: 0, left: 0, bottom: 0, right: 0 })
  const [header, setHeader] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [keys, setKeys] = useState<SortKeyDraft[]>([])
  const id = useId()
  useEffect(() => {
    if (!open) return
    const next = sortArea(view)
    const active = view.selection.active.col
    setArea(next)
    setHeader(guessHeader(view, next))
    setCaseSensitive(false)
    setKeys([{ col: active >= next.left && active <= next.right ? active : next.left, descending: false }])
  }, [open, view])
  const columns = Array.from({ length: Math.min(area.right - area.left + 1, 200) }, (_, index) => area.left + index)
  const columnLabel = (col: number) => {
    const name = header ? view.displayText(area.top, col).trim() : ''
    return name ? name : ui("Column {{name}}", { name: columnName(col) })
  }
  const unused = columns.find((col) => !keys.some((key) => key.col === col))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onOpenChange(false)
    view.sortArea(sortedRows(area, header), keys.map(({ col, descending }) => ({ col, descending })), { caseSensitive })
  }
  const update = (index: number, change: Partial<SortKeyDraft>) => setKeys(keys.map((key, at) => at === index ? { ...key, ...change } : key))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={focusGridOnClose(view)} data-sheet-sort-dialog="">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{ui("Sort range from {{range}}", { range: rangeName(area) })}</DialogTitle>
            <DialogDescription>{ui("Sort the rows of the range by one or more columns.")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />
            {ui("Data has header row")}
          </label>
          <div className="space-y-3">
            {keys.map((key, index) => (
              <div key={index} className="flex flex-wrap items-end gap-x-3 gap-y-2" data-sort-key={index}>
                {/* Wide enough to read a column's name: on a phone the order goes to the next line. */}
                <div className="min-w-40 flex-1 space-y-1">
                  <Label htmlFor={`${id}-column-${index}`} className="text-xs text-muted-foreground">{index === 0 ? ui("Sort by") : ui("Then by")}</Label>
                  <Select value={String(key.col)} onValueChange={(value) => update(index, { col: Number(value) })}>
                    <SelectTrigger id={`${id}-column-${index}`} className="w-full min-w-0" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((col) => <SelectItem key={col} value={String(col)}>{columnLabel(col)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <fieldset className="flex items-center gap-3 pb-1.5">
                  <legend className="sr-only">{ui("Order")}</legend>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={`${id}-order-${index}`} checked={!key.descending} onChange={() => update(index, { descending: false })} />
                    {ui("A → Z")}
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={`${id}-order-${index}`} checked={key.descending} onChange={() => update(index, { descending: true })} />
                    {ui("Z → A")}
                  </label>
                </fieldset>
                {keys.length > 1 && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={ui("Remove sort column")} onClick={() => setKeys(keys.filter((_, at) => at !== index))}>
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {unused !== undefined && keys.length < 8 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setKeys([...keys, { col: unused, descending: false }])}>
                <Plus className="size-4" />
                {ui("Add another sort column")}
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
            {ui("Case sensitive")}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Sort")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
