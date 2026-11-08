import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { TEXT_COLORS } from './docx-colors'

/**
 * Arrow keys move among a grid's buttons inside a menu, which would otherwise take them. At the
 * left edge ArrowLeft is left to the menu, so it closes a submenu as usual; other edges stay put.
 */
function moveInGrid(event: KeyboardEvent<HTMLButtonElement>, index: number, columns: number, count: number): void {
  const column = index % columns
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : event.key === 'ArrowUp' ? -columns : 0
  if (!delta || (event.key === 'ArrowLeft' && column === 0)) return
  event.preventDefault()
  event.stopPropagation()
  const next = index + delta
  const picker = event.currentTarget.closest('[data-picker]')
  // Below the last row: a button after the grid ("No shading"), if there is one.
  if (next >= count && event.key === 'ArrowDown') picker?.querySelector<HTMLButtonElement>('button[data-picker-after]')?.focus()
  if (next < 0 || next >= count || (event.key === 'ArrowRight' && column === columns - 1)) return
  picker?.querySelectorAll<HTMLButtonElement>('button[data-picker-cell]')[next]?.focus()
}

/**
 * A menu opened from the keyboard focuses itself; a grid inside it has no menu items for the
 * arrows to reach, so the grid takes that focus on its first cell.
 */
function useMenuFocusEntry(grid: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const menu = grid.current?.closest('[role="menu"]')
    if (!(menu instanceof HTMLElement)) return
    const onFocus = (event: FocusEvent) => {
      if (event.target === menu) grid.current?.querySelector<HTMLButtonElement>('button[data-picker-cell]')?.focus()
    }
    menu.addEventListener('focus', onFocus)
    return () => menu.removeEventListener('focus', onFocus)
  }, [grid])
}

const TABLE_GRID = 8

/** Docs' and Word's table size grid: point at (or arrow to) a size and click it. */
export function TableGridPicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 })
  const grid = useRef<HTMLDivElement>(null)
  useMenuFocusEntry(grid)
  return (
    <div className="p-1" onMouseLeave={() => setHover({ rows: 0, cols: 0 })} data-picker="" data-docx-table-grid="">
      <div ref={grid} className="grid grid-cols-8 gap-0.5" role="grid" aria-label={ui("Table size")}>
        {Array.from({ length: TABLE_GRID * TABLE_GRID }, (_, index) => {
          const row = Math.floor(index / TABLE_GRID) + 1
          const col = (index % TABLE_GRID) + 1
          const on = row <= hover.rows && col <= hover.cols
          return (
            <button
              key={index}
              type="button"
              aria-label={ui("{{rows}} by {{cols}} table", { rows: row, cols: col })}
              onMouseEnter={() => setHover({ rows: row, cols: col })}
              onFocus={() => setHover({ rows: row, cols: col })}
              onKeyDown={(event) => moveInGrid(event, index, TABLE_GRID, TABLE_GRID * TABLE_GRID)}
              onClick={() => onPick(row, col)}
              className={cn('size-4 cursor-pointer rounded-[2px] border outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-primary bg-primary/30' : 'border-border bg-background')}
              data-picker-cell=""
            />
          )
        })}
      </div>
      <div className="mt-1 text-center text-xs text-muted-foreground" aria-live="polite">{hover.rows ? ui("{{rows}} × {{cols}}", { rows: hover.rows, cols: hover.cols }) : ui("Insert table")}</div>
    </div>
  )
}

/** Word's Symbol gallery and the common half of Docs' Special characters. */
const SYMBOLS = [
  '©', '®', '™', '§', '¶', '†', '‡', '•',
  '…', '–', '—', '€', '£', '¥', '¢', '°',
  '±', '×', '÷', '≠', '≈', '≤', '≥', '∞',
  '√', '∑', 'π', 'α', 'β', 'µ', 'Ω', '‰',
  '¼', '½', '¾', '«', '»', '“', '”', '’',
  '←', '→', '↑', '↓', '✓', '✗', '★', '☆',
]

/** Insert ▸ Special characters: the common ones, one click each. */
export function SymbolGrid({ onPick }: { onPick: (symbol: string) => void }) {
  const grid = useRef<HTMLDivElement>(null)
  useMenuFocusEntry(grid)
  return (
    <div ref={grid} className="grid grid-cols-8 gap-0.5 p-1" role="group" aria-label={ui("Special characters")} data-picker="" data-docx-symbols="">
      {SYMBOLS.map((symbol, index) => (
        <button
          key={symbol}
          type="button"
          onKeyDown={(event) => moveInGrid(event, index, 8, SYMBOLS.length)}
          onClick={() => onPick(symbol)}
          className="size-6 cursor-pointer rounded text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={symbol}
          title={symbol}
          data-picker-cell=""
        >
          {symbol}
        </button>
      ))}
    </div>
  )
}

/** Table ▸ Cell shading: swatches, and No shading. */
export function ShadingSwatches({ onPick }: { onPick: (color: string | null) => void }) {
  const grid = useRef<HTMLDivElement>(null)
  useMenuFocusEntry(grid)
  return (
    <div className="p-1" data-picker="">
      <div ref={grid} className="grid grid-cols-8 gap-1" role="group" aria-label={ui("Cell shading")}>
        {TEXT_COLORS.map((color, index) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            title={color}
            onKeyDown={(event) => moveInGrid(event, index, 8, TEXT_COLORS.length)}
            onClick={() => onPick(color)}
            className="size-5 cursor-pointer rounded border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ background: color }}
            data-picker-cell=""
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onPick(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'ArrowUp') grid.current?.querySelectorAll<HTMLButtonElement>('button[data-picker-cell]')[TEXT_COLORS.length - 8]?.focus()
        }}
        className="mt-1 w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        data-picker-after=""
      >
        {ui("No shading")}
      </button>
    </div>
  )
}
