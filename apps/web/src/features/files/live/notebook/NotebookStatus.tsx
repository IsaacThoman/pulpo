import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NotebookEditorState } from '@pulpo/client-core/office/notebook/view'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useCellCursor, useNotebookView, type CursorStore } from './view-context'

/** Where the keyboard is, as JupyterLab's status bar says it: the caret while editing, else the active cell. */
export function NotebookPosition({ cursor: store, state }: { cursor: CursorStore; state: NotebookEditorState }) {
  const cursor = useCellCursor(store)
  const locale = activeLocale()
  if (state.mode === 'edit' && cursor && cursor.key === state.active) {
    return <span data-notebook-position>{cursor.selected ? uit`Ln ${cursor.line}, Col ${cursor.column} (${cursor.selected} selected)` : uit`Ln ${cursor.line}, Col ${cursor.column}`}</span>
  }
  const index = state.cells.findIndex((cell) => cell.key === state.active)
  if (index < 0) return null
  return <span data-notebook-position>{uit`Cell ${(index + 1).toLocaleString(locale)} of ${state.cells.length.toLocaleString(locale)}`}</span>
}

/** Outputs taller than this scroll inside their cell, as in Colab and classic Jupyter. */
const TALL_OUTPUT_PX = 448

/**
 * A code cell's outputs, scrolling once they grow taller than about half a screen (a long training
 * log no longer pushes the next cells far down), with a toggle to show them in full.
 */
export function OutputScroll({ cellKey, children }: { cellKey: string; children: ReactNode }) {
  const view = useNotebookView()
  const content = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  const expanded = view.expanded.has(cellKey)
  useEffect(() => {
    const element = content.current
    if (!element) return
    const measure = () => setTall(element.offsetHeight > TALL_OUTPUT_PX)
    measure()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const capped = tall && !expanded
  return (
    <div className="flex flex-col gap-1">
      <div className={cn(capped && 'max-h-[28rem] overflow-y-auto overscroll-contain rounded-sm')} data-output-scroll={capped || undefined}>
        <div ref={content} className="flex flex-col gap-1.5" data-output-content>{children}</div>
      </div>
      {tall && (
        <div className="flex gap-2">
          <div className="w-10 shrink-0 sm:w-14" />
          <button
            type="button"
            className="cursor-pointer rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            title={`${expanded ? ui("Scroll output") : ui("Show full output")} (Shift+O)`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => view.toggleExpanded(cellKey)}
          >
            {expanded ? ui("Scroll output") : ui("Show full output")}
          </button>
        </div>
      )}
    </div>
  )
}
