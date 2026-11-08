import { useId, useState } from 'react'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { nearZoom, steppedZoom, ZOOM_PRESETS, zoomPercent, type ZoomOptions } from './zoom'

/**
 * Zoom out, the zoom as a list of presets (and Fit), and zoom in, as Office's status bar and Docs'
 * toolbar have them. Zoom belongs to the person viewing, never the document. `compact` suits a
 * status bar. The buttons keep the document focused; the list hands focus back with `onDone`.
 *
 * Screen readers hear the zoom as each button's description (the names stay "Zoom out", "Zoom",
 * and "Zoom in"; the description is "100%"), and the new zoom once − or + changes it.
 */
export function ZoomControl({ compact, onDone, className, valueProps, ...options }: ZoomOptions & {
  compact?: boolean
  onDone?: () => void
  className?: string
  /** Extra attributes for the percentage, e.g. a test hook (`{ 'data-docx-zoom': '' }`). */
  valueProps?: Record<string, string | undefined>
}) {
  const { zoom, onZoom, presets = ZOOM_PRESETS, min = 0.25, max = 4, fitted, onFit } = options
  const valueId = useId()
  // What − and + announce: the zoom they set. The list announces its own choice as it is picked.
  const [announced, setAnnounced] = useState('')
  const step = (direction: 1 | -1) => {
    const next = steppedZoom(zoom, direction, options)
    setAnnounced(zoomPercent(next))
    onZoom(next)
  }
  const keepFocus = (event: React.MouseEvent) => event.preventDefault()
  const button = cn('grid shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40', compact ? 'size-6' : 'size-8')
  return (
    <div className={cn('flex shrink-0 items-center', compact ? 'gap-0 text-xs' : 'gap-0.5 text-sm', className)} data-zoom-control="">
      <button type="button" aria-label={ui("Zoom out")} aria-describedby={valueId} title={ui("Zoom out")} disabled={!fitted && zoom <= min} onMouseDown={keepFocus} onClick={() => step(-1)} className={button}>
        <Minus className={compact ? 'size-3' : 'size-4'} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ui("Zoom")}
            aria-describedby={valueId}
            title={ui("Zoom")}
            onMouseDown={keepFocus}
            className={cn('flex shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded px-1 tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground', compact ? 'h-6 min-w-12' : 'h-8 min-w-14')}
          >
            <span {...valueProps} id={valueId}>{fitted ? ui("Fit") : zoomPercent(zoom)}</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-24" onCloseAutoFocus={(event) => { event.preventDefault(); onDone?.() }}>
          {onFit && (
            <>
              <DropdownMenuCheckboxItem role="menuitemradio" checked={Boolean(fitted)} onSelect={onFit}>{ui("Fit")}</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          )}
          {presets.map((preset) => (
            <DropdownMenuCheckboxItem key={preset} role="menuitemradio" checked={!fitted && nearZoom(zoom, preset)} onSelect={() => onZoom(preset)}>
              {zoomPercent(preset)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" aria-label={ui("Zoom in")} aria-describedby={valueId} title={ui("Zoom in")} disabled={!fitted && zoom >= max} onMouseDown={keepFocus} onClick={() => step(1)} className={button}>
        <Plus className={compact ? 'size-3' : 'size-4'} />
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-zoom-announcement="">{announced}</span>
    </div>
  )
}
