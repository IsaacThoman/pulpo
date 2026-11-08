import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import { StickyNote } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ZoomControl } from '../chrome/ZoomControl'
import { PRESENTATION_ZOOM_PRESETS } from './presentation-shortcuts'


/**
 * The bar under the slide, as PowerPoint has it: "Slide 3 of 12", the speaker notes toggle, and
 * zoom with Fit (the zoom is the viewer's own, never the file's).
 */
export function PresentationStatusBar({ controller, notesOpen, onNotesChange, zoom, onZoom, onDone, view }: {
  controller: PresentationController
  notesOpen: boolean
  onNotesChange: (open: boolean) => void
  zoom: { zoom: number; fit: boolean }
  onZoom: (zoom: number | 'fit') => void
  /** Hands focus back to the slide after a zoom pick. */
  onDone?: () => void
  view: 'editor' | 'sorter'
}) {
  const keys = controller.slideKeys()
  const index = controller.state.slide ? keys.indexOf(controller.state.slide) : -1
  const selected = controller.state.slides.length
  return (
    <footer className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-t bg-background px-3 text-xs text-muted-foreground [scrollbar-width:none]" aria-label={ui("Status bar")} data-presentation-status="">
      <span className="truncate tabular-nums" aria-live="polite" data-slide-counter="">
        {view === 'sorter' && selected > 1
          ? ui("{{count}} slides selected", { count: selected })
          : index >= 0 ? ui("Slide {{index}} of {{count}}", { index: index + 1, count: keys.length }) : ui("{{count}} slides", { count: keys.length })}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {view === 'editor' && (
          <>
            <button
              type="button"
              aria-pressed={notesOpen}
              title={ui("Speaker notes")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onNotesChange(!notesOpen)}
              className={cn('flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 hover:bg-accent hover:text-foreground', notesOpen && 'text-foreground')}
            >
              <StickyNote className="size-3.5" />
              {ui("Notes")}
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            <ZoomControl
              compact
              zoom={zoom.zoom}
              fitted={zoom.fit}
              onZoom={(value) => onZoom(value)}
              onFit={() => onZoom('fit')}
              presets={PRESENTATION_ZOOM_PRESETS}
              min={0.1}
              max={8}
              onDone={onDone}
              valueProps={{ 'data-presentation-zoom': '' }}
            />
          </>
        )}
      </div>
    </footer>
  )
}
