import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { rangeName } from '@pulpo/client-core/office/sheets'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'
import { focusGridOnClose } from './dialog-focus'
import { CRITERIA, criterion, draftFromRule, EMPTY_DRAFT, EXISTING_CRITERION, ruleFromDraft, validationTarget, type CriterionId, type ValidationDraft, type ValidationTarget } from './validation-criteria'

/** Examples in the inputs: cell references read the same in every language. */
const RANGE_EXAMPLE = 'D1:D5'
const FORMULA_EXAMPLE = '=A1>0'

/**
 * Data ▸ Data validation, laid out like Google Sheets' rule panel: the range, the criteria with
 * their values, whether a list shows its arrow, and what invalid data does (a warning, or
 * rejecting it). With the selection inside a rule it edits that rule in place, ranges and all.
 */
export function ValidationDialog({ view, open, preset, onOpenChange }: {
  view: SheetView
  open: boolean
  /** Insert ▸ Dropdown starts a new list of items. */
  preset?: 'dropdown'
  onOpenChange: (open: boolean) => void
}) {
  const [target, setTarget] = useState<ValidationTarget>({ ranges: [] })
  const [draft, setDraft] = useState<ValidationDraft>(EMPTY_DRAFT)
  const [error, setError] = useState<{ field: 0 | 1; message: string }>()
  const first = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const second = useRef<HTMLInputElement>(null)
  const id = useId()
  const date1904 = view.workbook.date1904

  useEffect(() => {
    if (!open) return
    let next = validationTarget(view)
    // Insert ▸ Dropdown edits a list rule the selection is in, and otherwise starts a new list there.
    if (preset === 'dropdown' && next.rule && next.rule.type !== 'list') next = { ranges: view.selection.ranges }
    setTarget(next)
    setDraft(next.rule ? draftFromRule(next.rule, date1904) : EMPTY_DRAFT)
    setError(undefined)
  }, [open, view, preset, date1904])

  const spec = criterion(draft.criterion)
  const choices = draft.criterion === 'existing' ? [...CRITERIA, EXISTING_CRITERION] : CRITERIA
  const editing = target.ruleId !== undefined
  const hasRule = editing || !!view.getState().activeValidation
  const anchorRange = target.ranges[0]
  const setValue = (index: 0 | 1, value: string) => {
    const values: [string, string] = [...draft.values]
    values[index] = value
    setDraft({ ...draft, values })
    setError(undefined)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!anchorRange) return
    const built = ruleFromDraft(draft, { row: anchorRange.top, col: anchorRange.left }, { date1904, workbook: view.workbook, ...(target.rule ? { existing: target.rule } : {}) })
    if (!built.ok) {
      setError({ field: built.field, message: built.error })
      ;(built.field === 1 ? second.current : first.current)?.focus()
      return
    }
    onOpenChange(false)
    view.setValidation(built.rule, target.ruleId !== undefined ? { ruleId: target.ruleId } : {})
  }
  const remove = () => {
    onOpenChange(false)
    if (target.ruleId !== undefined) view.setValidation(undefined, { ruleId: target.ruleId })
    else view.setValidation(undefined)
  }

  const errorId = `${id}-error`
  const described = (field: 0 | 1) => error?.field === field ? errorId : undefined
  const valueInput = (field: 0 | 1, label: string, placeholder?: string) => (
    <Input
      ref={field === 0 ? first : second}
      aria-label={label}
      value={draft.values[field]}
      placeholder={placeholder}
      onChange={(event) => setValue(field, event.target.value)}
      aria-invalid={error?.field === field}
      aria-describedby={described(field)}
      spellCheck={false}
      className={spec.kind === 'formula' || spec.kind === 'range' ? 'font-mono' : undefined}
    />
  )
  const placeholder = spec.kind === 'date' ? ui("12/31/2026") : spec.kind === 'number' ? ui("Value or formula") : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={focusGridOnClose(view)} data-sheet-validation-dialog="">
        <form className="space-y-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? ui("Edit data validation rule") : ui("Data validation")}</DialogTitle>
            <DialogDescription>{ui("Apply to range: {{range}}", { range: target.ranges.map(rangeName).join(', ') })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-criteria`}>{ui("Criteria")}</Label>
            <Select value={draft.criterion} onValueChange={(value) => { setDraft({ ...draft, criterion: value as CriterionId }); setError(undefined) }}>
              <SelectTrigger id={`${id}-criteria`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {choices.map((entry, index) => (
                  <Fragment key={entry.id}>
                    {index > 0 && choices[index - 1]!.group !== entry.group && <SelectSeparator />}
                    <SelectItem value={entry.id}>{entry.label()}</SelectItem>
                  </Fragment>
                ))}
              </SelectContent>
            </Select>
          </div>
          {spec.kind === 'items' && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-items`}>{ui("Items, one per line")}</Label>
              <Textarea
                ref={first}
                id={`${id}-items`}
                rows={4}
                value={draft.values[0]}
                placeholder={ui("Option 1\nOption 2")}
                onChange={(event) => setValue(0, event.target.value)}
                aria-invalid={error?.field === 0}
                aria-describedby={described(0)}
                autoFocus
              />
            </div>
          )}
          {spec.kind === 'range' && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-range`}>{ui("Range")}</Label>
              <Input
                ref={first}
                id={`${id}-range`}
                value={draft.values[0]}
                placeholder={RANGE_EXAMPLE}
                onChange={(event) => setValue(0, event.target.value)}
                aria-invalid={error?.field === 0}
                aria-describedby={described(0)}
                spellCheck={false}
                className="font-mono"
                autoFocus
              />
            </div>
          )}
          {spec.values > 0 && spec.kind !== 'items' && spec.kind !== 'range' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">{valueInput(0, spec.kind === 'formula' ? ui("Formula") : spec.kind === 'text' ? ui("Text") : ui("Value"), spec.kind === 'formula' ? FORMULA_EXAMPLE : placeholder)}</div>
              {spec.values === 2 && (
                <>
                  <span className="text-sm text-muted-foreground">{ui("and")}</span>
                  <div className="min-w-0 flex-1">{valueInput(1, ui("Second value"), placeholder)}</div>
                </>
              )}
            </div>
          )}
          {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error.message}</p>}
          {(spec.kind === 'items' || spec.kind === 'range' || (draft.criterion === 'existing' && target.rule?.type === 'list')) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.showDropdown} onChange={(event) => setDraft({ ...draft, showDropdown: event.target.checked })} />
              {ui("Show a dropdown arrow in the cell")}
            </label>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{ui("If the data is invalid")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${id}-invalid`} checked={!draft.reject} onChange={() => setDraft({ ...draft, reject: false })} />
              {ui("Show a warning")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`${id}-invalid`} checked={draft.reject} onChange={() => setDraft({ ...draft, reject: true })} />
              {ui("Reject the input")}
            </label>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor={`${id}-message`}>{ui("Message for invalid data (optional)")}</Label>
            <Input id={`${id}-message`} value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} />
          </div>
          <DialogFooter className="gap-2 sm:items-center">
            {hasRule && <Button type="button" variant="ghost" className="sm:mr-auto" onClick={remove}>{ui("Remove rule")}</Button>}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Done")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
