import { useMemo, useState, type ReactNode } from 'react'
import { PRESET_SHAPE_GALLERY, presetGeometry } from '@pulpo/client-core/office/presentation'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'

/**
 * The pickers behind toolbar buttons: theme-aware colors (as Office shows them, with lighter and
 * darker variants of each theme color), the shape gallery, and the table size grid.
 */

const GALLERY_LABELS: Record<string, () => string> = {
  lines: () => ui("Lines"),
  rectangles: () => ui("Rectangles"),
  basicShapes: () => ui("Basic shapes"),
  blockArrows: () => ui("Block arrows"),
  equationShapes: () => ui("Equation shapes"),
  flowchart: () => ui("Flowchart"),
  starsAndBanners: () => ui("Stars and banners"),
  callouts: () => ui("Callouts"),
  actionButtons: () => ui("Action buttons"),
}

/** A DrawingML color value the picker produces, as a `a:solidFill` element (or none). */
export type ColorChoice = { kind: 'none' } | { kind: 'fill'; xml: string; css: string }

const THEME_SLOTS = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const
/** Office's variants: lighter 80/60/40%, darker 25/50%. */
const VARIANTS: { mod?: number; off?: number }[] = [{}, { mod: 20000, off: 80000 }, { mod: 40000, off: 60000 }, { mod: 60000, off: 40000 }, { mod: 75000 }, { mod: 50000 }]
const STANDARD = ['C00000', 'FF0000', 'FFC000', 'FFFF00', '92D050', '00B050', '00B0F0', '0070C0', '002060', '7030A0']

function adjust(hex: string, variant: { mod?: number; off?: number }): string {
  if (!variant.mod) return `#${hex}`
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  let l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  l = Math.min(1, l * (variant.mod / 100000) + (variant.off ?? 0) / 100000)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const value = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    const c = value < 1 / 6 ? p + (q - p) * 6 * value : value < 1 / 2 ? q : value < 2 / 3 ? p + (q - p) * (2 / 3 - value) * 6 : p
    return Math.round((s === 0 ? l : c) * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`
}

export function ColorPicker({ label, icon, theme, allowNone, onPick, disabled }: {
  label: string
  icon: ReactNode
  /** Theme colors after the color map: bg1, tx1, … as hex. */
  theme: Record<string, string>
  allowNone?: boolean
  onPick(choice: ColorChoice): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const pick = (choice: ColorChoice) => {
    onPick(choice)
    setOpen(false)
  }
  const custom = (value: string) => {
    const hex = value.replace('#', '').toUpperCase()
    if (/^[0-9A-F]{6}$/.test(hex)) pick({ kind: 'fill', xml: `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`, css: `#${hex}` })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{ui("Theme colors")}</p>
        <div className="grid grid-cols-10 gap-1" role="grid" aria-label={ui("Theme colors")}>
          {VARIANTS.map((variant, row) =>
            THEME_SLOTS.map((slot) => {
              const hex = theme[slot] ?? '000000'
              const css = adjust(hex, variant)
              const mods = `${variant.mod ? `<a:lumMod val="${variant.mod}"/>` : ''}${variant.off ? `<a:lumOff val="${variant.off}"/>` : ''}`
              return (
                <button
                  key={`${slot}-${row}`}
                  type="button"
                  aria-label={variant.mod ? `${slot} ${variant.off ? uit`lighter ${Math.round(variant.off / 1000)}%` : uit`darker ${100 - Math.round(variant.mod / 1000)}%`}` : slot}
                  title={slot}
                  className={cn('size-5 rounded-sm border border-black/10 dark:border-white/15', row === 0 && 'mb-1')}
                  style={{ background: css }}
                  onClick={() => pick({ kind: 'fill', xml: `<a:solidFill><a:schemeClr val="${slot}">${mods}</a:schemeClr></a:solidFill>`, css })}
                />
              )
            }),
          )}
        </div>
        <p className="mt-3 mb-2 text-xs font-medium text-muted-foreground">{ui("Standard colors")}</p>
        <div className="grid grid-cols-10 gap-1">
          {STANDARD.map((hex) => (
            <button key={hex} type="button" aria-label={`#${hex}`} title={`#${hex}`} className="size-5 rounded-sm border border-black/10 dark:border-white/15" style={{ background: `#${hex}` }} onClick={() => custom(hex)} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {ui("Custom")}
            <input type="color" className="h-6 w-10 cursor-pointer rounded border bg-transparent" onChange={(event) => custom(event.target.value)} />
          </label>
          {allowNone && (
            <button type="button" className="ml-auto rounded-md px-2 py-1 text-xs hover:bg-accent" onClick={() => pick({ kind: 'none' })}>
              {ui("No color")}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ShapeIcon({ preset }: { preset: string }) {
  const geometry = useMemo(() => presetGeometry(preset, 20, 20), [preset])
  return (
    <svg viewBox="-2 -2 24 24" className="size-5" aria-hidden>
      {geometry?.paths.map((path, index) => <path key={index} d={path.d} fill={path.fill === 'none' ? 'none' : 'currentColor'} fillOpacity={0.15} stroke={path.stroke ? 'currentColor' : 'none'} strokeWidth={1.2} />)}
    </svg>
  )
}

export function ShapeGallery({ trigger, onPick }: { trigger: ReactNode; onPick(preset: string): void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="max-h-[70vh] w-[22rem] overflow-y-auto p-3">
        {PRESET_SHAPE_GALLERY.map((group) => (
          <section key={group.id} className="mb-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{GALLERY_LABELS[group.id]?.() ?? group.label}</p>
            <div className="flex flex-wrap gap-0.5">
              {group.shapes.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  title={preset}
                  aria-label={preset}
                  data-preset={preset}
                  className="grid size-8 place-items-center rounded-md text-foreground/80 hover:bg-accent"
                  onClick={() => {
                    onPick(preset)
                    setOpen(false)
                  }}
                >
                  <ShapeIcon preset={preset} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function TablePicker({ trigger, onPick }: { trigger: ReactNode; onPick(rows: number, columns: number): void }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState({ rows: 0, columns: 0 })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <p className="mb-2 text-xs text-muted-foreground">{hover.rows ? uit`${hover.columns} × ${hover.rows} table` : ui("Insert table")}</p>
        <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHover({ rows: 0, columns: 0 })}>
          {Array.from({ length: 64 }, (_, index) => {
            const row = Math.floor(index / 8) + 1
            const column = (index % 8) + 1
            const active = row <= hover.rows && column <= hover.columns
            return (
              <button
                key={index}
                type="button"
                aria-label={uit`${column} × ${row} table`}
                className={cn('size-4 rounded-[2px] border', active ? 'border-primary bg-primary/30' : 'border-border bg-background')}
                onMouseEnter={() => setHover({ rows: row, columns: column })}
                onFocus={() => setHover({ rows: row, columns: column })}
                onClick={() => {
                  onPick(row, column)
                  setOpen(false)
                }}
              />
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
