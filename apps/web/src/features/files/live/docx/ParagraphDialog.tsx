import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { Alignment, ParagraphFormat, ParagraphFormatChange } from '@pulpo/client-core/office/docx/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { activeLocale, ui } from '@/i18n/ui'
import { formatNumber, type LengthUnit } from './page-units'
import { FLAGS, paragraphChange, paragraphFields, type FieldError, type Flag, type LineRule, type ParagraphDialogFocus, type ParagraphFields, type SpecialIndent } from './paragraph-format'
import { useSnapshotKey } from './use-snapshot-key'

function Field({ id, label, children, error }: { id: string; label: string; children: ReactNode; error?: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** "Left (in)", "Before (pt)". */
function withUnit(label: string, unit: string): string {
  return ui("{{label}} ({{unit}})", { label, unit })
}

/**
 * Word's Paragraph dialog (Docs' Indentation options and Custom spacing in one): alignment,
 * left and right indents with a first-line or hanging indent in inches or centimeters, spacing
 * before and after in points, line spacing as a multiple, exactly, or at least, and Word's line
 * and page break options. Applies in one undo step (`setParagraphFormat`).
 */
export function ParagraphDialog({ open, onOpenChange, format, unit, focus = 'indents', onApply, returnFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The first selected paragraph's format, read as the dialog opens. */
  format: ParagraphFormat | null
  unit: LengthUnit
  focus?: ParagraphDialogFocus
  onApply: (change: ParagraphFormatChange) => void
  returnFocus?: () => void
}) {
  const formKey = useSnapshotKey(format)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return
          event.preventDefault()
          returnFocus()
        }}
        data-docx-paragraph-dialog=""
      >
        {format && <ParagraphForm key={formKey} format={format} unit={unit} focus={focus} onCancel={() => onOpenChange(false)} onApply={(change) => { onOpenChange(false); onApply(change) }} />}
      </DialogContent>
    </Dialog>
  )
}

/** The dialog's form, mounted on each open with that paragraph's format. */
function ParagraphForm({ format, unit, focus, onCancel, onApply }: {
  format: ParagraphFormat
  unit: LengthUnit
  focus: ParagraphDialogFocus
  onCancel: () => void
  onApply: (change: ParagraphFormatChange) => void
}) {
  const id = useId()
  const locale = activeLocale()
  const [initial] = useState(() => paragraphFields(format, unit, locale))
  const [fields, setFields] = useState(initial)
  const [tab, setTab] = useState<'indents' | 'breaks'>(focus === 'breaks' ? 'breaks' : 'indents')
  const [error, setError] = useState<FieldError | null>(null)
  const set = <K extends keyof ParagraphFields>(key: K, value: ParagraphFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }))
    setError(null)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = paragraphChange(initial, fields, unit)
    if ('error' in result) {
      setError(result.error)
      setTab('indents')
      requestAnimationFrame(() => document.getElementById(`${id}-${result.error.field}`)?.focus())
      return
    }
    if (Object.keys(result.change).length) onApply(result.change)
    else onCancel()
  }

  const unitLabel = unit === 'in' ? ui("in") : ui("cm")
  const input = (field: 'left' | 'right' | 'by' | 'before' | 'after' | 'at', label: string, options: { disabled?: boolean; autoFocus?: boolean } = {}) => (
    <Field id={`${id}-${field}`} label={label} error={error?.field === field ? error.message : undefined}>
      <Input
        id={`${id}-${field}`}
        inputMode="decimal"
        value={options.disabled ? '' : fields[field]}
        disabled={options.disabled}
        aria-invalid={error?.field === field || undefined}
        aria-describedby={error?.field === field ? `${id}-${field}-error` : undefined}
        onChange={(event) => set(field, event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        autoFocus={options.autoFocus}
      />
    </Field>
  )
  const check = (field: Flag, label: string) => (
    <label key={field} className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={fields[field]} onChange={(event) => set(field, event.target.checked)} className="size-4 cursor-pointer accent-primary" />
      {label}
    </label>
  )
  const flagLabels: Record<Flag, string> = {
    widowControl: ui("Widow/Orphan control"),
    keepNext: ui("Keep with next"),
    keepLines: ui("Keep lines together"),
    pageBreakBefore: ui("Page break before"),
  }
  const heightRule = fields.rule === 'exact' || fields.rule === 'atLeast'
  const valueRule = heightRule || fields.rule === 'multiple'

  return (
    <form className="min-w-0 space-y-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{ui("Paragraph")}</DialogTitle>
        <DialogDescription>{ui("Indents, spacing, and line and page breaks of the selected paragraphs.")}</DialogDescription>
      </DialogHeader>
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'indents' | 'breaks')}>
        <TabsList className="w-full">
          <TabsTrigger value="indents">{ui("Indents and spacing")}</TabsTrigger>
          <TabsTrigger value="breaks">{ui("Line and page breaks")}</TabsTrigger>
        </TabsList>
        <TabsContent value="indents" className="space-y-4 pt-2">
          <Field id={`${id}-alignment`} label={ui("Alignment")}>
            <Select value={fields.alignment} onValueChange={(value) => set('alignment', value as Alignment)}>
              <SelectTrigger id={`${id}-alignment`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{ui("Align left")}</SelectItem>
                <SelectItem value="center">{ui("Center")}</SelectItem>
                <SelectItem value="right">{ui("Align right")}</SelectItem>
                <SelectItem value="both">{ui("Justify")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{ui("Indentation")}</legend>
            <div className="grid grid-cols-2 gap-3">
              {input('left', withUnit(ui("Left indent"), unitLabel), { autoFocus: focus === 'indents' })}
              {input('right', withUnit(ui("Right indent"), unitLabel))}
              <Field id={`${id}-special`} label={ui("Special")}>
                <Select value={fields.special} onValueChange={(value) => set('special', value as SpecialIndent)}>
                  <SelectTrigger id={`${id}-special`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{ui("None")}</SelectItem>
                    <SelectItem value="firstLine">{ui("First line")}</SelectItem>
                    <SelectItem value="hanging">{ui("Hanging")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {input('by', withUnit(ui("By"), unitLabel), { disabled: fields.special === 'none' })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{ui("Spacing")}</legend>
            <div className="grid grid-cols-2 gap-3">
              {input('before', withUnit(ui("Before"), ui("pt")), { autoFocus: focus === 'spacing' })}
              {input('after', withUnit(ui("After"), ui("pt")))}
              <Field id={`${id}-rule`} label={ui("Line spacing")}>
                <Select value={fields.rule} onValueChange={(value) => {
                  const rule = value as LineRule
                  setFields((current) => {
                    // A new kind of value starts from a sensible one: 1.15 lines, or 12 points.
                    const wasHeight = current.rule === 'exact' || current.rule === 'atLeast'
                    const at = rule === 'multiple' ? (current.rule === 'multiple' ? current.at : formatNumber(1.15, locale))
                      : rule === 'exact' || rule === 'atLeast' ? (wasHeight ? current.at : formatNumber(12, locale))
                        : current.at
                    return { ...current, rule, at }
                  })
                  setError(null)
                }}>
                  <SelectTrigger id={`${id}-rule`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">{ui("Single")}</SelectItem>
                    <SelectItem value="oneHalf">{ui("1.5 lines")}</SelectItem>
                    <SelectItem value="double">{ui("Double")}</SelectItem>
                    <SelectItem value="multiple">{ui("Multiple")}</SelectItem>
                    <SelectItem value="exact">{ui("Exactly")}</SelectItem>
                    <SelectItem value="atLeast">{ui("At least")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {input('at', heightRule ? withUnit(ui("At"), ui("pt")) : ui("At"), { disabled: !valueRule })}
            </div>
          </fieldset>
        </TabsContent>
        <TabsContent value="breaks" className="space-y-3 pt-2">
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{ui("Pagination")}</legend>
            {FLAGS.map((flag) => check(flag, flagLabels[flag]))}
          </fieldset>
        </TabsContent>
      </Tabs>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{ui("Cancel")}</Button>
        <Button type="submit">{ui("Apply")}</Button>
      </DialogFooter>
    </form>
  )
}
