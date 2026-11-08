import { useEffect, useState } from 'react'
import { minOf } from '@pulpo/client-core/collections'
import { cellsMap, notebookOutline, type NotebookOutlineCache, type NotebookOutlineEntry } from '@pulpo/client-core/office/notebook'
import { X } from 'lucide-react'
import type * as Y from 'yjs'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ToolbarButton } from '../../editor/ToolbarButton'

/** The outline is rebuilt this long after the last change (typing a heading, someone else's edits). */
const OUTLINE_DELAY_MS = 200

/** The notebook's Markdown headings, kept up to date as anyone edits. */
function useNotebookOutline(doc: Y.Doc): NotebookOutlineEntry[] {
  const [entries, setEntries] = useState<NotebookOutlineEntry[]>([])
  useEffect(() => {
    const cache: NotebookOutlineCache = new Map()
    let timer: number | undefined
    const update = () => setEntries(notebookOutline(doc, { cache }))
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, OUTLINE_DELAY_MS)
    }
    update()
    cellsMap(doc).observeDeep(later)
    return () => {
      window.clearTimeout(timer)
      cellsMap(doc).unobserveDeep(later)
    }
  }, [doc])
  return entries
}

/**
 * The table of contents beside the cells, as JupyterLab and Colab show it: Markdown headings by
 * level, the section holding the active cell marked, and a click goes to the heading's cell.
 */
export function NotebookOutline({ doc, activeIndex, overlay, onJump, onClose }: {
  doc: Y.Doc
  /** The active cell's place in the notebook, or -1. */
  activeIndex: number
  /** Floats over the cells (the side panel is too narrow to share). */
  overlay: boolean
  onJump: (key: string) => void
  onClose: () => void
}) {
  const entries = useNotebookOutline(doc)
  const top = Math.min(6, minOf(entries.map((entry) => entry.level)))
  // The active cell's section: the last heading at or above it.
  let current = -1
  entries.forEach((entry, index) => { if (entry.index <= activeIndex) current = index })
  return (
    <aside
      className={cn('flex w-64 shrink-0 flex-col border-r bg-background', overlay && 'absolute inset-y-0 left-0 z-20 max-w-[85%] shadow-lg')}
      aria-label={ui("Table of contents")}
      data-notebook-outline
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{ui("Table of contents")}</h2>
        <ToolbarButton label={ui("Close")} onClick={onClose}><X className="size-4" /></ToolbarButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length ? (
          <nav className="p-2">
            {entries.map((entry, index) => (
              <button
                key={`${entry.key}:${index}`}
                type="button"
                aria-current={index === current ? 'location' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onJump(entry.key)}
                title={entry.text}
                className={cn('block w-full cursor-pointer truncate rounded-md py-1 pr-2 text-left text-sm hover:bg-accent', index === current && 'bg-accent/70 font-medium', entry.level === top && 'font-medium')}
                style={{ paddingLeft: `${8 + (entry.level - top) * 12}px` }}
              >
                {entry.text}
              </button>
            ))}
          </nav>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{ui("Headings you add to Markdown cells appear here.")}</p>
        )}
      </div>
    </aside>
  )
}
