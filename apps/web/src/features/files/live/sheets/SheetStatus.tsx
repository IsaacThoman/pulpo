import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SheetSummary, SheetView, SheetViewState } from '@pulpo/client-core/office/sheets/view'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { ZoomControl } from '../chrome/ZoomControl'
import { AGGREGATES, aggregateText, aggregateValue, readAggregate, shownAggregate, writeAggregate, type Aggregate } from './aggregates'

/**
 * Google's "Sum: 1,234 ▾" (Excel's status bar figures): with several cells selected, one
 * aggregate shows and the list offers the others with their values. The choice is remembered;
 * a choice the selection has no value for (Sum of text) shows the count instead.
 */
export function SummaryChooser({ summary, onDone }: { summary: SheetSummary; onDone?: () => void }) {
  const [chosen, setChosen] = useState<Aggregate>(readAggregate)
  if (summary.count < 2) return null
  const shown = shownAggregate(summary, chosen)
  const text = aggregateText(shown, aggregateValue(summary, shown))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ui("Selection summary: {{value}}", { value: text })}
          onMouseDown={(event) => event.preventDefault()}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 self-center rounded-md px-2 text-xs text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
          data-sheet-summary={shown}
        >
          <span aria-live="polite">{text}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-48" onCloseAutoFocus={(event) => { event.preventDefault(); onDone?.() }}>
        {AGGREGATES.map((aggregate) => (
          <DropdownMenuCheckboxItem
            key={aggregate}
            role="menuitemradio"
            checked={aggregate === shown}
            onSelect={() => { setChosen(aggregate); writeAggregate(aggregate) }}
            className="tabular-nums"
            data-aggregate={aggregate}
          >
            {aggregateText(aggregate, aggregateValue(summary, aggregate))}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The right end of the sheet tab bar: the selection's figures and this viewer's zoom (Excel's
 * status bar). In a narrow editor (the side panel, a phone) the zoom gives its room to the tabs;
 * View ▸ Zoom and pinching still zoom there.
 */
export function SheetStatus({ view, state }: { view: SheetView; state: SheetViewState }) {
  return (
    <div className="flex shrink-0 items-center gap-1 pr-1" data-sheet-status="">
      <SummaryChooser summary={state.summary} onDone={() => view.focus()} />
      <ZoomControl compact className="hidden @lg:flex" zoom={state.zoom} onZoom={(zoom) => view.setZoom(zoom)} min={0.25} max={4} onDone={() => view.focus()} valueProps={{ 'data-sheet-zoom': '' }} />
    </div>
  )
}
