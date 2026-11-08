import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { PRESET_SHAPE_GALLERY, presetGeometry } from '@pulpo/client-core/office/presentation'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { galleryLabel, shapeName, STANDARD_COLORS, THEME_SLOTS, themeColorName } from './names'

/**
 * The pickers behind toolbar buttons: theme-aware colors (as Office shows them, with lighter and
 * darker variants of each theme color), the shape gallery, and the table size grid. Swatches and
 * shapes carry the names Office shows ("Accent 1, lighter 40%", "Rounded rectangle").
 */

/** A DrawingML color value the picker produces, as a `a:solidFill` element (or none). */
export type ColorChoice = { kind: 'none' } | { kind: 'fill'; xml: string; css: string }

/** Office's variants: lighter 80/60/40%, darker 25/50%. */
const VARIANTS: { mod?: number; off?: number }[] = [{}, { mod: 20000, off: 80000 }, { mod: 40000, off: 60000 }, { mod: 60000, off: 40000 }, { mod: 75000 }, { mod: 50000 }]

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

/** "Accent 1", or "Accent 1, lighter 40%" for a variant. */
function swatchName(slot: string, variant: { mod?: number; off?: number }): string {
  const name = themeColorName(slot)
  if (!variant.mod) return name
  const shade = variant.off ? uit`lighter ${Math.round(variant.off / 1000)}%` : uit`darker ${100 - Math.round(variant.mod / 1000)}%`
  return `${name}, ${shade}`
}

/**
 * A toolbar picker's close: focus goes back to the document (`onDone`: the slide or its text) when
 * it would otherwise land on the page, and stays where a click outside the picker put it.
 */
function closeAutoFocus(onDone: (() => void) | undefined) {
  if (!onDone) return undefined
  return (event: Event) => {
    event.preventDefault()
    const active = document.activeElement
    if (!active || active === document.body) onDone()
  }
}

const solid = (hex: string): ColorChoice => ({ kind: 'fill', xml: `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`, css: `#${hex}` })

/**
 * The palette: theme colors and their variants, Office's standard colors, a custom color, and
 * (with `noneLabel`) a way back to none or automatic.
 */
export function ColorPalette({ theme, onPick, noneLabel }: {
  theme: Record<string, string>
  onPick(choice: ColorChoice): void
  noneLabel?: string
}) {
  // The native picker reports every value while it is dragged in; only the one it closes on applies.
  const latest = useRef(onPick)
  latest.current = onPick
  const customInput = useCallback((input: HTMLInputElement | null) => {
    if (!input) return
    input.addEventListener('change', () => {
      const hex = input.value.replace('#', '').toUpperCase()
      if (/^[0-9A-F]{6}$/.test(hex)) latest.current(solid(hex))
    })
  }, [])
  return (
    <div data-color-palette="">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{ui("Theme colors")}</p>
      <div className="grid grid-cols-10 gap-1" role="grid" aria-label={ui("Theme colors")}>
        {VARIANTS.map((variant, row) =>
          THEME_SLOTS.map((slot) => {
            const hex = theme[slot] ?? '000000'
            const css = adjust(hex, variant)
            const mods = `${variant.mod ? `<a:lumMod val="${variant.mod}"/>` : ''}${variant.off ? `<a:lumOff val="${variant.off}"/>` : ''}`
            const name = swatchName(slot, variant)
            return (
              <button
                key={`${slot}-${row}`}
                type="button"
                aria-label={name}
                title={name}
                data-theme-color={slot}
                className={cn('size-5 cursor-pointer rounded-sm border border-black/10 dark:border-white/15', row === 0 && 'mb-1')}
                style={{ background: css }}
                onClick={() => onPick({ kind: 'fill', xml: `<a:solidFill><a:schemeClr val="${slot}">${mods}</a:schemeClr></a:solidFill>`, css })}
              />
            )
          }),
        )}
      </div>
      <p className="mt-3 mb-2 text-xs font-medium text-muted-foreground">{ui("Standard colors")}</p>
      <div className="grid grid-cols-10 gap-1">
        {STANDARD_COLORS.map(({ hex, name }) => (
          <button key={hex} type="button" aria-label={name()} title={name()} className="size-5 cursor-pointer rounded-sm border border-black/10 dark:border-white/15" style={{ background: `#${hex}` }} onClick={() => onPick(solid(hex))} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {ui("Custom")}
          <input ref={customInput} type="color" className="h-6 w-10 cursor-pointer rounded border bg-transparent" />
        </label>
        {noneLabel && (
          <button type="button" className="ml-auto cursor-pointer rounded-md px-2 py-1 text-xs hover:bg-accent" onClick={() => onPick({ kind: 'none' })}>
            {noneLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function ColorPicker({ label, icon, theme, allowNone, noneLabel, onPick, disabled, current, onDone }: {
  label: string
  icon: ReactNode
  /** Theme colors after the color map: bg1, tx1, … as hex. */
  theme: Record<string, string>
  /** Offers "No color" (or `noneLabel`: Automatic, No highlight). */
  allowNone?: boolean
  noneLabel?: string
  onPick(choice: ColorChoice): void
  disabled?: boolean
  /** The color in use, drawn as a bar under the icon (CSS). */
  current?: string
  /** Hands focus back to the document once the picker closes (toolbar pickers). */
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const pick = (choice: ColorChoice) => {
    onPick(choice)
    setOpen(false)
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
          className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {icon}
          {current && <span aria-hidden className="absolute inset-x-2 bottom-1 h-0.5 rounded-full" style={{ background: current }} />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={closeAutoFocus(onDone)}>
        <ColorPalette theme={theme} onPick={pick} {...(allowNone || noneLabel ? { noneLabel: noneLabel ?? ui("No color") } : {})} />
      </PopoverContent>
    </Popover>
  )
}

export function ShapeIcon({ preset, className }: { preset: string; className?: string }) {
  const geometry = useMemo(() => presetGeometry(preset, 20, 20), [preset])
  return (
    <svg viewBox="-2 -2 24 24" className={cn('size-5', className)} aria-hidden>
      {geometry?.paths.map((path, index) => <path key={index} d={path.d} fill={path.fill === 'none' ? 'none' : 'currentColor'} fillOpacity={0.15} stroke={path.stroke ? 'currentColor' : 'none'} strokeWidth={1.2} />)}
    </svg>
  )
}

export function ShapeGallery({ trigger, onPick, onDone }: { trigger: ReactNode; onPick(preset: string): void; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="max-h-[70vh] w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto p-3" onCloseAutoFocus={closeAutoFocus(onDone)}>
        {PRESET_SHAPE_GALLERY.map((group) => (
          <section key={group.id} className="mb-2" aria-label={galleryLabel(group.id, group.label)}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{galleryLabel(group.id, group.label)}</p>
            <div className="flex flex-wrap gap-0.5">
              {group.shapes.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  title={shapeName(preset)}
                  aria-label={shapeName(preset)}
                  data-preset={preset}
                  className="grid size-8 cursor-pointer place-items-center rounded-md text-foreground/80 hover:bg-accent"
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

/** Hover or focus a cell to size the table (8 × 8, as Google Slides offers); `onPick(rows, columns)`. */
export function TableGrid({ onPick }: { onPick(rows: number, columns: number): void }) {
  const [hover, setHover] = useState({ rows: 0, columns: 0 })
  return (
    <div data-table-grid="">
      <p className="mb-2 text-xs text-muted-foreground">{hover.rows ? uit`${hover.columns} × ${hover.rows} table` : ui("Insert table")}</p>
      <div className="grid w-max grid-cols-8 gap-0.5" onMouseLeave={() => setHover({ rows: 0, columns: 0 })}>
        {Array.from({ length: 64 }, (_, index) => {
          const row = Math.floor(index / 8) + 1
          const column = (index % 8) + 1
          const active = row <= hover.rows && column <= hover.columns
          return (
            <button
              key={index}
              type="button"
              aria-label={uit`${column} × ${row} table`}
              className={cn('size-4 cursor-pointer rounded-[2px] border', active ? 'border-primary bg-primary/30' : 'border-border bg-background')}
              onMouseEnter={() => setHover({ rows: row, columns: column })}
              onFocus={() => setHover({ rows: row, columns: column })}
              onClick={() => onPick(row, column)}
            />
          )
        })}
      </div>
    </div>
  )
}

export function TablePicker({ trigger, onPick, onDone }: { trigger: ReactNode; onPick(rows: number, columns: number): void; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-3" onCloseAutoFocus={closeAutoFocus(onDone)}>
        <TableGrid
          onPick={(rows, columns) => {
            onPick(rows, columns)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** A cell of a grid of menu items (shapes, table sizes, characters): arrow keys move through the cells. */
export function MenuGridItem({ id, label, onSelect, className, children, onFocus, onPointerEnter }: {
  id: string
  label: string
  onSelect: () => void
  className?: string
  children?: ReactNode
  onFocus?: () => void
  onPointerEnter?: () => void
}) {
  return (
    <DropdownMenuItem
      aria-label={label}
      title={label}
      data-menu-item={id}
      onSelect={onSelect}
      onFocus={onFocus}
      onPointerEnter={onPointerEnter}
      className={cn('justify-center p-0', className)}
    >
      {children}
    </DropdownMenuItem>
  )
}

/** Insert ▸ Table in a menu: point at (or arrow to) a cell to size the table, as in Docs and Slides. */
export function MenuTableGrid({ onPick }: { onPick(rows: number, columns: number): void }) {
  const [size, setSize] = useState({ rows: 0, columns: 0 })
  return (
    <div className="p-1" data-table-grid="">
      <p className="mb-1.5 px-1 text-xs text-muted-foreground" aria-hidden>{size.rows ? uit`${size.columns} × ${size.rows} table` : ui("Insert table")}</p>
      <div className="grid w-max grid-cols-8 gap-0.5" role="group" aria-label={ui("Insert table")}>
        {Array.from({ length: 64 }, (_, index) => {
          const row = Math.floor(index / 8) + 1
          const column = (index % 8) + 1
          const active = row <= size.rows && column <= size.columns
          return (
            <MenuGridItem
              key={index}
              id={`table-${column}x${row}`}
              label={uit`${column} × ${row} table`}
              className={cn('size-5 rounded-[2px] border', active ? 'border-primary bg-primary/30 focus:bg-primary/30' : 'border-border bg-background')}
              onFocus={() => setSize({ rows: row, columns: column })}
              onPointerEnter={() => setSize({ rows: row, columns: column })}
              onSelect={() => onPick(row, column)}
            />
          )
        })}
      </div>
    </div>
  )
}

/** "No color" in a menu of swatches: an empty swatch with a stroke through it. */
export function NoColorSwatch({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative size-4 shrink-0 overflow-hidden rounded-sm border border-black/15 bg-background dark:border-white/20', className)}>
      <span className="absolute top-1/2 left-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-destructive" />
    </span>
  )
}
