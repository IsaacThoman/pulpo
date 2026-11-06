import type { ReactNode } from 'react'
import type { SheetColor } from '@pulpo/client-core/office/sheets'
import { cssColor, type ThemeColors } from '@pulpo/client-core/office/sheets/view'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'

/** Excel's palette: the ten theme colors with their tint rows, then the standard colors. */
const THEME_TINTS: Record<number, number[]> = {
  0: [-0.05, -0.15, -0.25, -0.35, -0.5],
  1: [0.5, 0.35, 0.25, 0.15, 0.05],
  2: [-0.1, -0.25, -0.5, -0.75, -0.9],
  3: [0.8, 0.6, 0.4, -0.25, -0.5],
}
const ACCENT_TINTS = [0.8, 0.6, 0.4, -0.25, -0.5]
const STANDARD = ['C00000', 'FF0000', 'FFC000', 'FFFF00', '92D050', '00B050', '00B0F0', '0070C0', '002060', '7030A0']

export function ColorPicker({ label, theme, automaticLabel, onPick, children, disabled }: {
  label: string
  theme: ThemeColors
  /** The "no color" choice: Automatic for text, No fill for fills. */
  automaticLabel: string
  onPick: (color: SheetColor | null) => void
  children: ReactNode
  disabled?: boolean
}) {
  const swatch = (color: SheetColor, title: string) => {
    const css = cssColor(color, theme) ?? '#FFFFFF'
    return (
      <button
        key={JSON.stringify(color)}
        type="button"
        title={title}
        aria-label={title}
        onClick={() => onPick(color)}
        className="size-5 cursor-pointer rounded-[3px] border border-black/10 hover:scale-110 hover:border-foreground/60 dark:border-white/15"
        style={{ backgroundColor: css }}
      />
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <button type="button" onClick={() => onPick(null)} className="mb-2 w-full cursor-pointer rounded-md px-2 py-1 text-left text-sm hover:bg-accent">
          {automaticLabel}
        </button>
        <div className="text-xs text-muted-foreground">{ui("Theme colors")}</div>
        <div className="mt-1 grid grid-cols-10 gap-1">{Array.from({ length: 10 }, (_, index) => swatch({ theme: index }, ui("Theme color {{n}}", { n: index + 1 })))}</div>
        <div className="mt-1 grid grid-flow-col grid-cols-10 grid-rows-5 gap-1">
          {Array.from({ length: 10 }, (_, index) =>
            (THEME_TINTS[index] ?? ACCENT_TINTS).map((tint) => swatch({ theme: index, tint }, ui("Theme color {{n}}, {{percent}}%", { n: index + 1, percent: Math.round(Math.abs(tint) * 100) * (tint < 0 ? -1 : 1) }))),
          )}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{ui("Standard colors")}</div>
        <div className="mt-1 grid grid-cols-10 gap-1">{STANDARD.map((rgb) => swatch({ rgb: `FF${rgb}` }, `#${rgb}`))}</div>
      </PopoverContent>
    </Popover>
  )
}

/** A small bar of the current color under an icon (text color, fill color). */
export function ColorBar({ color, className }: { color: string | undefined; className?: string }) {
  return <span aria-hidden className={cn('absolute bottom-1 left-1.5 right-1.5 h-[3px] rounded-full', className)} style={{ backgroundColor: color ?? 'transparent' }} />
}
