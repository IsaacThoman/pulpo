import { useEffect, useId, useState, type FormEvent } from 'react'
import { formatValue } from '@pulpo/client-core/office/sheets'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { focusGridOnClose } from './dialog-focus'

/** Codes Google's and Excel's custom format lists start with. */
const SUGGESTIONS = ['0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '0.00E+00', '"$"#,##0.00;[Red]-"$"#,##0.00', '#,##0.00;(#,##0.00)', 'yyyy-mm-dd', 'mmm d, yyyy', 'h:mm AM/PM', '[h]:mm:ss', '@']

/** The sample the preview formats: the active cell's own value when it has one. */
function sampleValue(view: SheetView): number | string {
  const { row, col } = view.selection.active
  const value = view.valueAt(row, col)
  return typeof value === 'number' || typeof value === 'string' && value !== '' ? value : 1234.5678
}

function preview(code: string, value: number | string, date1904: boolean): { text: string; color?: string; error: boolean } {
  try {
    const result = formatValue(value, code || 'General', { date1904 })
    return { text: result.text, ...(result.color ? { color: result.color } : {}), error: !!result.formatError }
  } catch {
    return { text: '', error: true }
  }
}

/**
 * Format ▸ Number ▸ Custom number format: type a format code and see the active cell (and a
 * negative number) the way it would show, as Google Sheets' dialog does.
 */
export function NumberFormatDialog({ view, open, onOpenChange }: { view: SheetView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const id = useId()
  useEffect(() => {
    if (!open) return
    const current = view.getState().activeStyle.numFmt
    setCode(current === 'General' ? '' : current)
    setError(undefined)
  }, [open, view])
  const date1904 = view.workbook.date1904
  const value = sampleValue(view)
  const shown = preview(code, value, date1904)
  const negative = typeof value === 'number' ? preview(code, -Math.abs(value), date1904) : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) {
      setError(ui("Enter a number format."))
      return
    }
    if (shown.error) {
      setError(ui("This number format isn't valid."))
      return
    }
    onOpenChange(false)
    view.setNumberFormat(trimmed)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={focusGridOnClose(view)} data-sheet-number-format-dialog="">
        <form className="space-y-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{ui("Custom number format")}</DialogTitle>
            <DialogDescription>{ui("Use Excel's format codes, like #,##0.00 or yyyy-mm-dd.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-code`}>{ui("Format code")}</Label>
            <Input
              id={`${id}-code`}
              value={code}
              onChange={(event) => { setCode(event.target.value); setError(undefined) }}
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              aria-invalid={!!error}
              aria-describedby={`${id}-preview${error ? ` ${id}-error` : ''}`}
              autoFocus
            />
            {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <div id={`${id}-preview`} className="rounded-md border bg-muted/40 px-3 py-2 text-sm" aria-live="polite">
            <div className="text-xs text-muted-foreground">{ui("Preview")}</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-4 font-mono tabular-nums" data-number-format-preview="">
              <span style={shown.color ? { color: shown.color } : undefined}>{shown.error ? ui("Not a valid format") : shown.text || ' '}</span>
              {negative && !negative.error && <span className="text-muted-foreground" style={negative.color ? { color: negative.color } : undefined}>{negative.text}</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{ui("Common formats")}</div>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => { setCode(suggestion); setError(undefined) }}
                  className={cn('cursor-pointer rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent', suggestion === code && 'border-primary bg-accent')}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
