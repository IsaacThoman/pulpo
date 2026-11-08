import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  colorScaleRule,
  dataBarRule,
  formulaRule,
  highlightRule,
  iconSetRule,
  type ColorScalePreset,
  type ConditionalRuleInput,
  type ConditionalStyle,
  type DataBarPreset,
  type HighlightKind,
  type IconSetPreset,
  type SheetView,
} from '@pulpo/client-core/office/sheets/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { focusGridOnClose } from './dialog-focus'

export type ConditionalTab = 'single' | 'scale' | 'bars' | 'icons'

type Condition = HighlightKind | 'formula'

/** Google's "Format cells if…" list, grouped as Excel's Highlight Cells and Top/Bottom rules. */
const CONDITIONS: { id: Condition; label: () => string; values: 0 | 1 | 2; kind?: 'text' | 'rank' | 'formula'; group: number }[] = [
  { id: 'blanks', label: () => ui("Is empty"), values: 0, group: 0 },
  { id: 'notBlanks', label: () => ui("Is not empty"), values: 0, group: 0 },
  { id: 'errors', label: () => ui("Is an error"), values: 0, group: 0 },
  { id: 'textContains', label: () => ui("Text contains"), values: 1, kind: 'text', group: 1 },
  { id: 'textNotContains', label: () => ui("Text does not contain"), values: 1, kind: 'text', group: 1 },
  { id: 'beginsWith', label: () => ui("Text starts with"), values: 1, kind: 'text', group: 1 },
  { id: 'endsWith', label: () => ui("Text ends with"), values: 1, kind: 'text', group: 1 },
  { id: 'greaterThan', label: () => ui("Greater than"), values: 1, group: 2 },
  { id: 'greaterThanOrEqual', label: () => ui("Greater than or equal to"), values: 1, group: 2 },
  { id: 'lessThan', label: () => ui("Less than"), values: 1, group: 2 },
  { id: 'lessThanOrEqual', label: () => ui("Less than or equal to"), values: 1, group: 2 },
  { id: 'equal', label: () => ui("Is equal to"), values: 1, group: 2 },
  { id: 'notEqual', label: () => ui("Is not equal to"), values: 1, group: 2 },
  { id: 'between', label: () => ui("Is between"), values: 2, group: 2 },
  { id: 'top', label: () => ui("Top N items"), values: 1, kind: 'rank', group: 3 },
  { id: 'bottom', label: () => ui("Bottom N items"), values: 1, kind: 'rank', group: 3 },
  { id: 'topPercent', label: () => ui("Top N%"), values: 1, kind: 'rank', group: 3 },
  { id: 'bottomPercent', label: () => ui("Bottom N%"), values: 1, kind: 'rank', group: 3 },
  { id: 'aboveAverage', label: () => ui("Above average"), values: 0, group: 3 },
  { id: 'belowAverage', label: () => ui("Below average"), values: 0, group: 3 },
  { id: 'duplicateValues', label: () => ui("Duplicate values"), values: 0, group: 3 },
  { id: 'uniqueValues', label: () => ui("Unique values"), values: 0, group: 3 },
  { id: 'formula', label: () => ui("Custom formula is"), values: 1, kind: 'formula', group: 4 },
]

/** The preset highlight styles (CONDITIONAL_STYLES) with the colors their dxf entries use. */
const STYLES: { id: ConditionalStyle; label: () => string; fill?: string; font?: string; border?: string }[] = [
  { id: 'lightRedFillDarkRedText', label: () => ui("Light red fill with dark red text"), fill: '#FFC7CE', font: '#9C0006' },
  { id: 'yellowFillDarkYellowText', label: () => ui("Yellow fill with dark yellow text"), fill: '#FFEB9C', font: '#9C5700' },
  { id: 'greenFillDarkGreenText', label: () => ui("Green fill with dark green text"), fill: '#C6EFCE', font: '#006100' },
  { id: 'lightRedFill', label: () => ui("Light red fill"), fill: '#FFC7CE' },
  { id: 'redText', label: () => ui("Red text"), font: '#9C0006' },
  { id: 'redBorder', label: () => ui("Red border"), border: '#9C0006' },
  { id: 'alternateFill', label: () => ui("Light gray fill"), fill: '#F3F3F3' },
]

/** Lowest value's color first, as conditional-presets.ts lists them. */
const SCALES: { id: ColorScalePreset; label: () => string; colors: string[] }[] = [
  { id: 'greenYellowRed', label: () => ui("Red, yellow, green"), colors: ['#F8696B', '#FFEB84', '#63BE7B'] },
  { id: 'redYellowGreen', label: () => ui("Green, yellow, red"), colors: ['#63BE7B', '#FFEB84', '#F8696B'] },
  { id: 'greenWhiteRed', label: () => ui("Red, white, green"), colors: ['#F8696B', '#FCFCFF', '#63BE7B'] },
  { id: 'redWhiteGreen', label: () => ui("Green, white, red"), colors: ['#63BE7B', '#FCFCFF', '#F8696B'] },
  { id: 'blueWhiteRed', label: () => ui("Red, white, blue"), colors: ['#F8696B', '#FCFCFF', '#5A8AC6'] },
  { id: 'redWhiteBlue', label: () => ui("Blue, white, red"), colors: ['#5A8AC6', '#FCFCFF', '#F8696B'] },
  { id: 'whiteGreen', label: () => ui("Green to white"), colors: ['#63BE7B', '#FCFCFF'] },
  { id: 'whiteRed', label: () => ui("Red to white"), colors: ['#F8696B', '#FCFCFF'] },
  { id: 'greenWhite', label: () => ui("White to green"), colors: ['#FCFCFF', '#63BE7B'] },
  { id: 'redWhite', label: () => ui("White to red"), colors: ['#FCFCFF', '#F8696B'] },
]

const BARS: { id: DataBarPreset; label: () => string; color: string }[] = [
  { id: 'blue', label: () => ui("Blue"), color: '#638EC6' },
  { id: 'green', label: () => ui("Green"), color: '#63C384' },
  { id: 'red', label: () => ui("Red"), color: '#FF555A' },
  { id: 'orange', label: () => ui("Orange"), color: '#FFB628' },
  { id: 'lightBlue', label: () => ui("Light blue"), color: '#008AEF' },
  { id: 'purple', label: () => ui("Purple"), color: '#D6007B' },
]

/** Icon sets with a glyph preview of each icon, lowest band first. */
const ICONS: { id: IconSetPreset; label: () => string; preview: { glyph: string; color: string }[] }[] = [
  { id: '3Arrows', label: () => ui("3 arrows"), preview: [{ glyph: '↓', color: '#C00000' }, { glyph: '→', color: '#FFC000' }, { glyph: '↑', color: '#00B050' }] },
  { id: '3ArrowsGray', label: () => ui("3 gray arrows"), preview: [{ glyph: '↓', color: '#808080' }, { glyph: '→', color: '#808080' }, { glyph: '↑', color: '#808080' }] },
  { id: '3TrafficLights1', label: () => ui("3 traffic lights"), preview: [{ glyph: '●', color: '#C00000' }, { glyph: '●', color: '#FFC000' }, { glyph: '●', color: '#00B050' }] },
  { id: '3Signs', label: () => ui("3 signs"), preview: [{ glyph: '◆', color: '#C00000' }, { glyph: '▲', color: '#FFC000' }, { glyph: '●', color: '#00B050' }] },
  { id: '3Symbols', label: () => ui("3 symbols"), preview: [{ glyph: '✖', color: '#C00000' }, { glyph: '!', color: '#FFC000' }, { glyph: '✔', color: '#00B050' }] },
  { id: '3Flags', label: () => ui("3 flags"), preview: [{ glyph: '⚑', color: '#C00000' }, { glyph: '⚑', color: '#FFC000' }, { glyph: '⚑', color: '#00B050' }] },
  { id: '3Stars', label: () => ui("3 stars"), preview: [{ glyph: '☆', color: '#FFC000' }, { glyph: '⯪', color: '#FFC000' }, { glyph: '★', color: '#FFC000' }] },
  { id: '4Arrows', label: () => ui("4 arrows"), preview: [{ glyph: '↓', color: '#C00000' }, { glyph: '↘', color: '#FFC000' }, { glyph: '↗', color: '#FFC000' }, { glyph: '↑', color: '#00B050' }] },
  { id: '4TrafficLights', label: () => ui("4 traffic lights"), preview: [{ glyph: '●', color: '#262626' }, { glyph: '●', color: '#C00000' }, { glyph: '●', color: '#FFC000' }, { glyph: '●', color: '#00B050' }] },
  { id: '4Rating', label: () => ui("4 ratings"), preview: [{ glyph: '▁', color: '#1F4E79' }, { glyph: '▃', color: '#1F4E79' }, { glyph: '▅', color: '#1F4E79' }, { glyph: '▇', color: '#1F4E79' }] },
  { id: '5Arrows', label: () => ui("5 arrows"), preview: [{ glyph: '↓', color: '#C00000' }, { glyph: '↘', color: '#FFC000' }, { glyph: '→', color: '#FFC000' }, { glyph: '↗', color: '#FFC000' }, { glyph: '↑', color: '#00B050' }] },
  { id: '5Rating', label: () => ui("5 ratings"), preview: [{ glyph: '▁', color: '#1F4E79' }, { glyph: '▂', color: '#1F4E79' }, { glyph: '▄', color: '#1F4E79' }, { glyph: '▆', color: '#1F4E79' }, { glyph: '█', color: '#1F4E79' }] },
  { id: '5Quarters', label: () => ui("5 quarters"), preview: [{ glyph: '○', color: '#404040' }, { glyph: '◔', color: '#404040' }, { glyph: '◑', color: '#404040' }, { glyph: '◕', color: '#404040' }, { glyph: '●', color: '#404040' }] },
]

/** A choice in a list of presets: a radio with its preview. */
function PresetOption({ name, value, checked, onChange, label, children }: { name: string; value: string; checked: boolean; onChange: () => void; label: string; children: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/60 has-focus-visible:ring-2 has-focus-visible:ring-ring/50', checked && 'border-primary bg-accent/60')} data-checked={checked || undefined}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {children}
      <span className="min-w-0 flex-1">{label}</span>
      {checked && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
    </label>
  )
}

/**
 * Format ▸ Conditional formatting, as Google's panel and Excel's gallery: a single color when cells
 * match a condition, a color scale, data bars, or icon sets for the selected range. New rules go
 * on top of the sheet's others; Clear rules removes them from the selection or the whole sheet.
 */
export function ConditionalFormatDialog({ view, open, tab: initialTab = 'single', onOpenChange }: {
  view: SheetView
  open: boolean
  tab?: ConditionalTab
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = useState<ConditionalTab>(initialTab)
  const [condition, setCondition] = useState<Condition>('greaterThan')
  const [values, setValues] = useState<[string, string]>(['', ''])
  const [style, setStyle] = useState<ConditionalStyle>('lightRedFillDarkRedText')
  const [scale, setScale] = useState<ColorScalePreset>('greenYellowRed')
  const [bar, setBar] = useState<DataBarPreset>('blue')
  const [icons, setIcons] = useState<IconSetPreset>('3Arrows')
  const [error, setError] = useState<string>()
  const id = useId()
  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    setValues(['', ''])
    setError(undefined)
  }, [open, initialTab])
  const spec = CONDITIONS.find((entry) => entry.id === condition)!
  const range = view.getState().selectionLabel

  const rule = (): ConditionalRuleInput | string => {
    if (tab === 'scale') return colorScaleRule(scale)
    if (tab === 'bars') return dataBarRule(bar)
    if (tab === 'icons') return iconSetRule(icons)
    const [first, second] = values
    if (spec.values >= 1 && !first.trim()) return spec.kind === 'formula' ? ui("Enter a formula, like =A1>0.") : ui("Enter a value.")
    if (spec.values === 2 && !second.trim()) return ui("Enter a value.")
    if (spec.kind === 'rank' && !(Number(first) >= 1)) return ui("Enter a number of 1 or more.")
    if (condition === 'formula') return formulaRule(first.trim().replace(/^=/, ''), style)
    return highlightRule(condition, spec.values === 2 ? [first, second] : spec.values === 1 ? [first] : [], style)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = rule()
    if (typeof input === 'string') {
      setError(input)
      return
    }
    onOpenChange(false)
    view.addConditionalRule(input)
  }
  const clear = (scope: 'selection' | 'sheet') => {
    onOpenChange(false)
    view.clearConditionalFormats(scope)
  }
  const setValue = (index: 0 | 1, value: string) => {
    const next: [string, string] = [...values]
    next[index] = value
    setValues(next)
    setError(undefined)
  }
  const valueInput = (index: 0 | 1, label: string) => (
    <Input
      aria-label={label}
      value={values[index]}
      onChange={(event) => setValue(index, event.target.value)}
      inputMode={spec.kind === 'rank' ? 'numeric' : undefined}
      placeholder={spec.kind === 'formula' ? FORMULA_EXAMPLE : spec.kind === 'rank' ? '10' : spec.kind === 'text' ? undefined : ui("Value or formula")}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      spellCheck={false}
      className={spec.kind === 'formula' ? 'font-mono' : undefined}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={focusGridOnClose(view)} data-sheet-conditional-dialog="">
        <form className="min-w-0 space-y-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{ui("Conditional formatting")}</DialogTitle>
            <DialogDescription>{ui("Apply to range: {{range}}", { range })}</DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(value) => { setTab(value as ConditionalTab); setError(undefined) }}>
            {/* Tabs wrap onto a second row rather than overflow: a centered row that overflows cuts off its first tab. */}
            <TabsList className="h-auto w-full flex-wrap">
              <TabsTrigger value="single">{ui("Single color")}</TabsTrigger>
              <TabsTrigger value="scale">{ui("Color scale")}</TabsTrigger>
              <TabsTrigger value="bars">{ui("Data bars")}</TabsTrigger>
              <TabsTrigger value="icons">{ui("Icon sets")}</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor={`${id}-condition`}>{ui("Format cells if…")}</Label>
                <Select value={condition} onValueChange={(value) => { setCondition(value as Condition); setError(undefined) }}>
                  <SelectTrigger id={`${id}-condition`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {CONDITIONS.map((entry, index) => [
                      index > 0 && CONDITIONS[index - 1]!.group !== entry.group ? <SelectSeparator key={`separator-${entry.id}`} /> : null,
                      <SelectItem key={entry.id} value={entry.id}>{entry.label()}</SelectItem>,
                    ])}
                  </SelectContent>
                </Select>
              </div>
              {spec.values > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">{valueInput(0, spec.kind === 'formula' ? ui("Formula") : spec.kind === 'rank' ? ui("Number of items") : ui("Value"))}</div>
                  {spec.values === 2 && (
                    <>
                      <span className="text-sm text-muted-foreground">{ui("and")}</span>
                      <div className="min-w-0 flex-1">{valueInput(1, ui("Second value"))}</div>
                    </>
                  )}
                </div>
              )}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{ui("Formatting style")}</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {STYLES.map((entry) => (
                    <PresetOption key={entry.id} name={`${id}-style`} value={entry.id} checked={style === entry.id} onChange={() => setStyle(entry.id)} label={entry.label()}>
                      <span
                        aria-hidden
                        className="grid h-6 w-9 shrink-0 place-items-center rounded-sm border text-xs font-medium"
                        style={{ backgroundColor: entry.fill ?? '#FFFFFF', color: entry.font ?? '#000000', borderColor: entry.border ?? 'rgb(0 0 0 / 0.12)' }}
                      >
                        {SAMPLE_TEXT}
                      </span>
                    </PresetOption>
                  ))}
                </div>
              </fieldset>
            </TabsContent>
            <TabsContent value="scale" className="pt-2">
              <fieldset className="grid gap-1.5 sm:grid-cols-2">
                <legend className="sr-only">{ui("Color scale")}</legend>
                {SCALES.map((entry) => (
                  <PresetOption key={entry.id} name={`${id}-scale`} value={entry.id} checked={scale === entry.id} onChange={() => setScale(entry.id)} label={entry.label()}>
                    <span aria-hidden className="h-5 w-12 shrink-0 rounded-sm border" style={{ backgroundImage: `linear-gradient(to right, ${entry.colors.join(', ')})` }} />
                  </PresetOption>
                ))}
              </fieldset>
              <p className="mt-2 text-xs text-muted-foreground">{ui("The lowest value takes the first color, the highest the last.")}</p>
            </TabsContent>
            <TabsContent value="bars" className="pt-2">
              <fieldset className="grid gap-1.5 sm:grid-cols-2">
                <legend className="sr-only">{ui("Data bars")}</legend>
                {BARS.map((entry) => (
                  <PresetOption key={entry.id} name={`${id}-bar`} value={entry.id} checked={bar === entry.id} onChange={() => setBar(entry.id)} label={entry.label()}>
                    <span aria-hidden className="flex h-5 w-12 shrink-0 flex-col justify-center gap-0.5 rounded-sm border bg-white px-0.5">
                      <span className="h-1.5 w-full rounded-[1px]" style={{ backgroundColor: entry.color }} />
                      <span className="h-1.5 w-1/2 rounded-[1px]" style={{ backgroundColor: entry.color }} />
                    </span>
                  </PresetOption>
                ))}
              </fieldset>
            </TabsContent>
            <TabsContent value="icons" className="pt-2">
              <fieldset className="grid gap-1.5 sm:grid-cols-2">
                <legend className="sr-only">{ui("Icon sets")}</legend>
                {ICONS.map((entry) => (
                  <PresetOption key={entry.id} name={`${id}-icons`} value={entry.id} checked={icons === entry.id} onChange={() => setIcons(entry.id)} label={entry.label()}>
                    <span aria-hidden className="flex w-16 shrink-0 gap-0.5 text-sm leading-none">
                      {entry.preview.map((icon, index) => <span key={index} style={{ color: icon.color }}>{icon.glyph}</span>)}
                    </span>
                  </PresetOption>
                ))}
              </fieldset>
            </TabsContent>
          </Tabs>
          {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" className="sm:mr-auto">
                  {ui("Clear rules")}
                  <ChevronDown className="size-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => clear('selection')}>{ui("From selected cells")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => clear('sheet')}>{ui("From entire sheet")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Done")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The example in the custom formula input: references read the same in every language. */
const FORMULA_EXAMPLE = '=A1>0'
/** The sample a style preview shows, as Google's and Excel's style pickers do. */
const SAMPLE_TEXT = 'Aa'
