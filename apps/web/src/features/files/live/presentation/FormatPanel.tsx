import { useEffect, useId, useState } from 'react'
import { EMU_PER_PX, lineEdits } from '@pulpo/client-core/office/presentation'
import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import { FlipHorizontal2, FlipVertical2, PaintBucket, PenLine, RotateCcw, RotateCw, X } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToolbarButton } from '@/features/files/editor/ToolbarButton'
import { activeLocale, ui } from '@/i18n/ui'
import { DASHES } from './names'
import { ColorPicker } from './pickers'
import { themeColors } from './theme'

/**
 * The format side panel (Slides' Format options, PowerPoint's Format Shape): size, position, and
 * rotation, text box options, fill, outline, shadow, and alt text of the selected shapes, or the
 * slide background when nothing is selected. Lengths show in centimeters for Spanish and inches
 * otherwise, like Office.
 */

const EMU_PER_INCH = 914_400
const EMU_PER_CM = 360_000
const LINE_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]
const DEFAULT_LINE_FILL = '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
const SHADOW = '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>'
const selectClass = 'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground'

function NumberField({ label, value, unit, onCommit, step = 0.01, min }: { label: string; value: number | undefined; unit: string; onCommit(value: number): void; step?: number; min?: number }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(Math.round(value * 100) / 100))
  useEffect(() => setDraft(value === undefined ? '' : String(Math.round(value * 100) / 100)), [value])
  const commit = () => {
    const number = Number(draft.replace(',', '.'))
    if (Number.isFinite(number) && draft !== '' && (min === undefined || number >= min)) onCommit(number)
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          min={min}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
          className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        />
        <span>{unit}</span>
      </span>
    </label>
  )
}

/** The picture's (or shape's) description for screen readers; saved when the field is left. */
function AltText({ value, onCommit }: { value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(value)
  const id = useId()
  useEffect(() => setDraft(value), [value])
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium"><label htmlFor={id}>{ui("Alt text")}</label></h2>
      <Textarea
        id={id}
        value={draft}
        rows={3}
        placeholder={ui("Describe it for people who cannot see it")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { if (draft.trim() !== value) onCommit(draft.trim()) }}
        className="min-h-16 text-sm"
      />
    </section>
  )
}

export function FormatPanel({ controller, onClose }: { controller: PresentationController; onClose?: () => void }) {
  const metric = activeLocale() === 'es-ES'
  const unitEmu = metric ? EMU_PER_CM : EMU_PER_INCH
  const unit = metric ? 'cm' : 'in'
  const id = useId()
  const slide = controller.state.slide
  const keys = controller.state.shapes
  const key = keys[0]
  const xfrm = slide && key ? controller.shapeXfrm(slide, key) : undefined
  const shape = slide && key ? controller.shape(slide, key) : undefined
  const theme = themeColors(controller)
  const [lockAspect, setLockAspect] = useState(false)
  const set = (patch: Partial<NonNullable<typeof xfrm>>) => {
    if (!key) return
    controller.setXfrm(key, patch)
  }
  if (!slide) return null
  const header = (title: string) => (
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-medium">{title}</h2>
      {onClose && <ToolbarButton label={ui("Close")} onClick={onClose}><X className="size-4" /></ToolbarButton>}
    </div>
  )
  if (!key || !xfrm) {
    return (
      <div className="flex flex-col gap-4 p-4 text-sm" aria-label={ui("Format slide")}>
        {header(ui("Slide background"))}
        <div className="flex items-center gap-2">
          <ColorPicker label={ui("Background color")} icon={<PaintBucket className="size-4" />} theme={theme} onPick={(choice) => controller.setBackground(choice.kind === 'fill' ? choice.xml : undefined)} />
          <span className="text-muted-foreground">{ui("Background color")}</span>
        </div>
        <button type="button" className="self-start rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => controller.setBackground(undefined)}>
          {ui("Reset to layout background")}
        </button>
      </div>
    )
  }
  const line = shape?.line ?? ''
  const lineWidth = Number(/\bw="(\d+)"/.exec(line)?.[1] ?? 9525) / 12_700
  const dash = /prstDash val="(\w+)"/.exec(line)?.[1] ?? 'solid'
  // A shape with no line of its own or from its style (a text box) draws one once given a width or dash.
  const drawsNoLine = !/<a:(noFill|solidFill|gradFill|pattFill)\b/.test(line) && !/<a:lnRef\b[^>]*\bidx="[1-9]/.test(shape?.xml ?? '')
  // Only what changed is written: arrowheads, caps, and the theme's line color stay.
  const setLine = (patch: { width?: number; fill?: string; dash?: string }) => {
    const fill = patch.fill ?? (drawsNoLine && (patch.width !== undefined || patch.dash !== undefined) ? DEFAULT_LINE_FILL : undefined)
    controller.editLine(
      ...(patch.width !== undefined ? [lineEdits.width(patch.width * 12_700)] : []),
      ...(fill !== undefined ? [lineEdits.fill(fill)] : []),
      ...(patch.dash !== undefined ? [lineEdits.dash(patch.dash)] : []),
    )
  }
  const shadow = /outerShdw/.test(shape?.effects ?? '')
  // Tables, charts, and other frames stay upright, as in PowerPoint.
  const turns = shape?.kind !== 'graphicFrame' && shape?.kind !== 'opaque'
  const format = controller.formatState()
  const box = !format.notes ? format.textBox : undefined
  const knownDashes = DASHES.some((entry) => entry.value === dash)
  return (
    <div className="flex flex-col gap-4 p-4 text-sm" aria-label={ui("Format shape")}>
      {header(ui("Format options"))}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{ui("Size and position")}</h2>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={ui("Width")} unit={unit} value={xfrm.cx / unitEmu} onCommit={(value) => set(lockAspect && xfrm.cx ? { cx: value * unitEmu, cy: (xfrm.cy * value * unitEmu) / xfrm.cx } : { cx: value * unitEmu })} />
          <NumberField label={ui("Height")} unit={unit} value={xfrm.cy / unitEmu} onCommit={(value) => set(lockAspect && xfrm.cy ? { cy: value * unitEmu, cx: (xfrm.cx * value * unitEmu) / xfrm.cy } : { cy: value * unitEmu })} />
          <NumberField label={ui("Horizontal position")} unit={unit} value={xfrm.x / unitEmu} onCommit={(value) => set({ x: value * unitEmu })} />
          <NumberField label={ui("Vertical position")} unit={unit} value={xfrm.y / unitEmu} onCommit={(value) => set({ y: value * unitEmu })} />
          <NumberField label={ui("Rotation")} unit="°" step={1} value={(xfrm.rot ?? 0) / 60000} onCommit={(value) => set({ rot: Math.round((((value % 360) + 360) % 360) * 60000) })} />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={lockAspect} onCheckedChange={setLockAspect} aria-label={ui("Lock aspect ratio")} />
          {ui("Lock aspect ratio")}
        </label>
        {turns && (
          <div className="flex items-center gap-0.5" role="group" aria-label={ui("Rotate")}>
            <ToolbarButton label={ui("Rotate counter-clockwise 90°")} onClick={() => controller.rotateBy(-90)}><RotateCcw className="size-4" /></ToolbarButton>
            <ToolbarButton label={ui("Rotate clockwise 90°")} onClick={() => controller.rotateBy(90)}><RotateCw className="size-4" /></ToolbarButton>
            <ToolbarButton label={ui("Flip horizontally")} onClick={() => controller.flip('horizontal')}><FlipHorizontal2 className="size-4" /></ToolbarButton>
            <ToolbarButton label={ui("Flip vertically")} onClick={() => controller.flip('vertical')}><FlipVertical2 className="size-4" /></ToolbarButton>
          </div>
        )}
      </section>
      {box && (
        <section className="flex flex-col gap-2" data-format-text-box="">
          <h2 className="font-medium">{ui("Text fitting")}</h2>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {ui("Vertical alignment")}
            <select value={box.anchor} onChange={(event) => controller.setTextAnchor(event.target.value as 't' | 'ctr' | 'b')} className={selectClass}>
              <option value="t">{ui("Top")}</option>
              <option value="ctr">{ui("Middle")}</option>
              <option value="b">{ui("Bottom")}</option>
            </select>
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs text-muted-foreground">{ui("Autofit")}</legend>
            {([
              ['none', ui("Do not autofit")],
              ['norm', ui("Shrink text on overflow")],
              ['shape', ui("Resize shape to fit text")],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name={`${id}-autofit`} value={value} checked={box.autofit === value} onChange={() => controller.setAutofit(value)} className="accent-primary" />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={ui("Left margin")} unit={unit} min={0} value={box.insets.l / unitEmu} onCommit={(value) => controller.setTextInsets({ l: Math.round(value * unitEmu) })} />
            <NumberField label={ui("Right margin")} unit={unit} min={0} value={box.insets.r / unitEmu} onCommit={(value) => controller.setTextInsets({ r: Math.round(value * unitEmu) })} />
            <NumberField label={ui("Top margin")} unit={unit} min={0} value={box.insets.t / unitEmu} onCommit={(value) => controller.setTextInsets({ t: Math.round(value * unitEmu) })} />
            <NumberField label={ui("Bottom margin")} unit={unit} min={0} value={box.insets.b / unitEmu} onCommit={(value) => controller.setTextInsets({ b: Math.round(value * unitEmu) })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={box.wrap} onCheckedChange={(wrap) => controller.setTextWrap(wrap)} aria-label={ui("Wrap text in shape")} />
            {ui("Wrap text in shape")}
          </label>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{ui("Fill")}</h2>
        <div className="flex items-center gap-2">
          <ColorPicker label={ui("Shape fill")} icon={<PaintBucket className="size-4" />} theme={theme} allowNone onPick={(choice) => controller.setShapeProperty('fill', choice.kind === 'fill' ? choice.xml : '<a:noFill/>')} />
          <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => controller.setShapeProperty('fill', undefined)}>
            {ui("Automatic")}
          </button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{ui("Line")}</h2>
        <div className="flex items-center gap-2">
          <ColorPicker label={ui("Line color")} icon={<PenLine className="size-4" />} theme={theme} allowNone onPick={(choice) => setLine({ fill: choice.kind === 'fill' ? choice.xml : '<a:noFill/>' })} />
          <select aria-label={ui("Line width")} value={LINE_WIDTHS.includes(lineWidth) ? lineWidth : ''} onChange={(event) => setLine({ width: Number(event.target.value) })} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            {!LINE_WIDTHS.includes(lineWidth) && <option value="">{`${Math.round(lineWidth * 100) / 100} pt`}</option>}
            {LINE_WIDTHS.map((width) => (
              <option key={width} value={width}>{`${width} pt`}</option>
            ))}
          </select>
          <select aria-label={ui("Dash type")} value={dash} onChange={(event) => setLine({ dash: event.target.value })} className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm">
            {!knownDashes && <option value={dash}>{dash}</option>}
            {DASHES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.name()}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="flex items-center gap-2">
        <Switch checked={shadow} onCheckedChange={(on) => controller.setShapeProperty('effects', on ? SHADOW : '<a:effectLst/>')} aria-label={ui("Shadow")} />
        <span>{ui("Shadow")}</span>
      </section>
      {keys.length === 1 && shape && <AltText key={shape.key} value={shape.descr ?? ''} onCommit={(value) => controller.setShapeProperty('descr', value || undefined)} />}
      <p className="text-xs text-muted-foreground">{`${Math.round(xfrm.cx / EMU_PER_PX)} × ${Math.round(xfrm.cy / EMU_PER_PX)} px`}</p>
    </div>
  )
}
