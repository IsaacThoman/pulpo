import { useEffect, useState } from 'react'
import { EMU_PER_PX, lineEdits } from '@pulpo/client-core/office/presentation'
import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import { PaintBucket, PenLine } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { activeLocale, ui } from '@/i18n/ui'
import { ColorPicker } from './pickers'
import { themeColors } from './theme'

/**
 * The format side panel: size and position, rotation, fill, outline, and shadow of the selected
 * shapes, or the slide background when nothing is selected. Lengths show in centimeters for
 * Spanish and inches otherwise, like Office.
 */

const EMU_PER_INCH = 914_400
const EMU_PER_CM = 360_000
const LINE_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]
const DASHES = ['solid', 'dot', 'dash', 'lgDash', 'dashDot', 'sysDash', 'sysDot']
const SHADOW = '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>'

function NumberField({ label, value, unit, onCommit, step = 0.01 }: { label: string; value: number | undefined; unit: string; onCommit(value: number): void; step?: number }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(Math.round(value * 100) / 100))
  useEffect(() => setDraft(value === undefined ? '' : String(Math.round(value * 100) / 100)), [value])
  const commit = () => {
    const number = Number(draft.replace(',', '.'))
    if (Number.isFinite(number) && draft !== '') onCommit(number)
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
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

export function FormatPanel({ controller }: { controller: PresentationController }) {
  const metric = activeLocale() === 'es-ES'
  const unitEmu = metric ? EMU_PER_CM : EMU_PER_INCH
  const unit = metric ? 'cm' : 'in'
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
  if (!key || !xfrm) {
    return (
      <div className="flex flex-col gap-4 p-4 text-sm" aria-label={ui("Format slide")}>
        <h2 className="font-medium">{ui("Slide background")}</h2>
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
  // Only what changed is written: arrowheads, caps, and the theme's line color stay.
  const setLine = (patch: { width?: number; fill?: string; dash?: string }) => {
    controller.editLine(
      ...(patch.width !== undefined ? [lineEdits.width(patch.width * 12_700)] : []),
      ...(patch.fill !== undefined ? [lineEdits.fill(patch.fill)] : []),
      ...(patch.dash !== undefined ? [lineEdits.dash(patch.dash)] : []),
    )
  }
  const shadow = /outerShdw/.test(shape?.effects ?? '')
  return (
    <div className="flex flex-col gap-4 p-4 text-sm" aria-label={ui("Format shape")}>
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
      </section>
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
          <select aria-label={ui("Dash type")} value={dash} onChange={(event) => setLine({ dash: event.target.value })} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            {DASHES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="flex items-center gap-2">
        <Switch checked={shadow} onCheckedChange={(on) => controller.setShapeProperty('effects', on ? SHADOW : '<a:effectLst/>')} aria-label={ui("Shadow")} />
        <span>{ui("Shadow")}</span>
      </section>
      <p className="text-xs text-muted-foreground">{`${Math.round(xfrm.cx / EMU_PER_PX)} × ${Math.round(xfrm.cy / EMU_PER_PX)} px`}</p>
    </div>
  )
}
