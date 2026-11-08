import { useState } from 'react'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { FONT_SIZE_PRESETS, formatFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE, parseFontSize } from './font-size'

/**
 * A Google Docs style font size box: type any size and press Enter, or pick one from the list,
 * or step with − and +. Escape (or leaving the box) restores the current size. Steppers and the
 * list keep the document focused; `onDone` hands focus back after typing.
 */
export function FontSizeInput({ value, onChange, onStep, sizes = FONT_SIZE_PRESETS, min = MIN_FONT_SIZE, max = MAX_FONT_SIZE, disabled, label, onDone, className }: {
  /** The selection's size in points; null when it is mixed. */
  value: number | null
  onChange: (size: number) => void
  /** −/+ step by one point from `value`; editors that step mixed sizes themselves pass this. */
  onStep?: (direction: 1 | -1) => void
  sizes?: readonly number[]
  min?: number
  max?: number
  disabled?: boolean
  label?: string
  onDone?: () => void
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : formatFontSize(value))
  const step = (direction: 1 | -1) => {
    if (onStep) return onStep(direction)
    if (value === null) return
    const next = Math.min(max, Math.max(min, Math.round(value) + direction))
    if (next !== value) onChange(next)
  }
  const apply = () => {
    const size = draft === null ? null : parseFontSize(draft, min, max)
    setDraft(null)
    if (size !== null && size !== value) onChange(size)
    onDone?.()
  }
  const keepFocus = (event: React.MouseEvent) => event.preventDefault()
  const stepper = 'grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className={cn('flex h-8 shrink-0 items-center', className)} data-font-size-input="">
      <button type="button" aria-label={ui("Decrease font size")} title={ui("Decrease font size")} disabled={disabled || (value !== null && value <= min)} onMouseDown={keepFocus} onClick={() => step(-1)} className={stepper}>
        <Minus className="size-3.5" />
      </button>
      <div className="flex h-7 items-center rounded-md border border-input focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <input
          value={shown}
          inputMode="decimal"
          aria-label={label ?? ui("Font size")}
          placeholder="–"
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              onDone?.()
            }
          }}
          className="h-full w-9 min-w-0 bg-transparent text-center text-sm tabular-nums outline-none disabled:cursor-not-allowed disabled:opacity-40"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" aria-label={ui("Font sizes")} title={ui("Font sizes")} onMouseDown={keepFocus} className="grid h-full w-4 cursor-pointer place-items-center rounded-r-md text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 min-w-20" onCloseAutoFocus={(event) => { event.preventDefault(); onDone?.() }}>
            {sizes.map((size) => (
              <DropdownMenuCheckboxItem key={size} role="menuitemradio" checked={value === size} onSelect={() => { if (size !== value) onChange(size) }}>
                {formatFontSize(size)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button type="button" aria-label={ui("Increase font size")} title={ui("Increase font size")} disabled={disabled || (value !== null && value >= max)} onMouseDown={keepFocus} onClick={() => step(1)} className={stepper}>
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
