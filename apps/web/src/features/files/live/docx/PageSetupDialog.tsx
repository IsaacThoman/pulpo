import { useId, useState, type FormEvent } from 'react'
import type { PageSetupChange, PageSetupInfo } from '@pulpo/client-core/office/docx/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { activeLocale, ui } from '@/i18n/ui'
import {
  formatNumber,
  MARGIN_PRESETS,
  marginPresetOf,
  PAPER_SIZES,
  paperName,
  paperSizeOf,
  parseMargins,
  pointsTo,
  type LengthUnit,
  type MarginPresetId,
  type MarginSide,
} from './page-units'
import { useSnapshotKey } from './use-snapshot-key'

const SIDES: readonly MarginSide[] = ['top', 'bottom', 'left', 'right']

export type PageSetupScope = 'document' | 'section'

/** The page setup the dialog opened with: the cursor's section, and how many sections there are. */
export type PageSetupState = PageSetupInfo & { section: number; sections: number }

function marginPresetName(id: MarginPresetId): string {
  switch (id) {
    case 'normal': return ui("Normal")
    case 'narrow': return ui("Narrow")
    case 'moderate': return ui("Moderate")
    case 'wide': return ui("Wide")
  }
}

function sideName(side: MarginSide): string {
  switch (side) {
    case 'top': return ui("Top margin")
    case 'bottom': return ui("Bottom margin")
    case 'left': return ui("Left margin")
    case 'right': return ui("Right margin")
  }
}

/**
 * Docs' File ▸ Page setup and Word's Layout ▸ Margins, Orientation, and Size in one dialog:
 * orientation, paper size, and margins (with Word's presets) in inches or centimeters, for the
 * whole document or the section at the cursor. Section properties have no tracked form, so
 * while suggesting it explains that and changes nothing.
 */
export function PageSetupDialog({ open, onOpenChange, setup, unit, suggesting, onApply, returnFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  setup: PageSetupState | null
  unit: LengthUnit
  suggesting: boolean
  /** False when the margins leave no room for text. */
  onApply: (change: PageSetupChange, scope: PageSetupScope) => boolean
  returnFocus?: () => void
}) {
  const formKey = useSnapshotKey(setup)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return
          event.preventDefault()
          returnFocus()
        }}
        data-docx-page-setup=""
      >
        {setup && <PageSetupForm key={formKey} setup={setup} unit={unit} suggesting={suggesting} onApply={onApply} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function PageSetupForm({ setup, unit, suggesting, onApply, onClose }: {
  setup: PageSetupState
  unit: LengthUnit
  suggesting: boolean
  onApply: (change: PageSetupChange, scope: PageSetupScope) => boolean
  onClose: () => void
}) {
  const id = useId()
  const locale = activeLocale()
  const shown = (points: number) => formatNumber(pointsTo(points, unit), locale)
  const [orientation, setOrientation] = useState(setup.orientation)
  const [initialPaper] = useState(() => paperSizeOf(setup.width, setup.height)?.id ?? 'custom')
  const [paper, setPaper] = useState(initialPaper)
  const [initialMargins] = useState(() => Object.fromEntries(SIDES.map((side) => [side, shown(setup.margins[side])])) as Record<MarginSide, string>)
  const [margins, setMargins] = useState(initialMargins)
  const [scope, setScope] = useState<PageSetupScope>('document')
  const [error, setError] = useState<{ side?: MarginSide; message: string } | null>(null)

  const parsed = parseMargins(margins, unit)
  const preset = 'margins' in parsed ? marginPresetOf(parsed.margins) ?? 'custom' : 'custom'
  const unitLabel = unit === 'in' ? ui("in") : ui("cm")
  const size = (width: number, height: number) => ui("{{width}} × {{height}} {{unit}}", { width: shown(width), height: shown(height), unit: unitLabel })
  // The page's own size, portrait way round, for a custom paper size.
  const portrait: [number, number] = setup.width <= setup.height ? [setup.width, setup.height] : [setup.height, setup.width]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (suggesting) return
    if ('side' in parsed) {
      setError({ side: parsed.side, message: ui("Enter a margin of 0 or more.") })
      document.getElementById(`${id}-${parsed.side}`)?.focus()
      return
    }
    // Only what the person changed: every section of the document keeps its own paper size and
    // margins when only the orientation changes, and a collaborator's change to the rest stays.
    const change: PageSetupChange = {}
    if (orientation !== setup.orientation) change.orientation = orientation
    const chosen = PAPER_SIZES.find((candidate) => candidate.id === paper)
    if (paper !== initialPaper && chosen) {
      change.width = chosen.width
      change.height = chosen.height
    }
    // The four margins are one setting, as a preset sets them.
    if (SIDES.some((side) => margins[side] !== initialMargins[side])) change.margins = parsed.margins
    if (!Object.keys(change).length) {
      onClose()
      return
    }
    if (!onApply(change, scope)) {
      setError({ message: ui("These margins leave no room for text on this paper size.") })
      return
    }
    onClose()
  }

  return (
    <form className="min-w-0 space-y-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{ui("Page setup")}</DialogTitle>
        <DialogDescription>
          {suggesting
            ? ui("Page setup can't be suggested. Switch to Editing to change it.")
            : ui("Paper size, orientation, and margins of the pages.")}
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={suggesting} className="min-w-0 space-y-4 disabled:opacity-60">
        {setup.sections > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-scope`}>{ui("Apply to")}</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as PageSetupScope)} disabled={suggesting}>
              <SelectTrigger id={`${id}-scope`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="document">{ui("Whole document")}</SelectItem>
                <SelectItem value="section">{ui("This section")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{ui("Orientation")}</legend>
          <div className="flex gap-4">
            {(['portrait', 'landscape'] as const).map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={`${id}-orientation`} value={value} checked={orientation === value} onChange={() => setOrientation(value)} className="size-4 cursor-pointer accent-primary" />
                {value === 'portrait' ? ui("Portrait") : ui("Landscape")}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-paper`}>{ui("Paper size")}</Label>
          <Select value={paper} onValueChange={setPaper} disabled={suggesting}>
            <SelectTrigger id={`${id}-paper`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAPER_SIZES.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>{ui("{{name}} ({{size}})", { name: paperName(candidate.id), size: size(candidate.width, candidate.height) })}</SelectItem>
              ))}
              {!paperSizeOf(setup.width, setup.height) && (
                <SelectItem value="custom">{ui("Custom ({{size}})", { size: size(portrait[0], portrait[1]) })}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{ui("Margins ({{unit}})", { unit: unitLabel })}</legend>
          <Select
            value={preset}
            disabled={suggesting}
            onValueChange={(value) => {
              const chosen = MARGIN_PRESETS[value as MarginPresetId]
              if (!chosen) return
              setMargins(Object.fromEntries(SIDES.map((side) => [side, shown(chosen[side])])) as Record<MarginSide, string>)
              setError(null)
            }}
          >
            <SelectTrigger aria-label={ui("Margin presets")} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(MARGIN_PRESETS) as MarginPresetId[]).map((presetId) => {
                const values = MARGIN_PRESETS[presetId]
                return (
                  <SelectItem key={presetId} value={presetId}>
                    {ui("{{name}}: top {{top}}, bottom {{bottom}}, left {{left}}, right {{right}}", {
                      name: marginPresetName(presetId),
                      top: shown(values.top),
                      bottom: shown(values.bottom),
                      left: shown(values.left),
                      right: shown(values.right),
                    })}
                  </SelectItem>
                )
              })}
              <SelectItem value="custom" disabled={preset !== 'custom'}>{ui("Custom")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            {SIDES.map((side) => (
              <div key={side} className="min-w-0 space-y-1.5">
                <Label htmlFor={`${id}-${side}`}>{sideName(side)}</Label>
                <Input
                  id={`${id}-${side}`}
                  inputMode="decimal"
                  value={margins[side]}
                  aria-invalid={error?.side === side || undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setMargins((values) => ({ ...values, [side]: event.target.value }))
                    setError(null)
                  }}
                />
              </div>
            ))}
          </div>
        </fieldset>
        {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error.message}</p>}
      </fieldset>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>{suggesting ? ui("Close") : ui("Cancel")}</Button>
        {!suggesting && <Button type="submit">{ui("Apply")}</Button>}
      </DialogFooter>
    </form>
  )
}
