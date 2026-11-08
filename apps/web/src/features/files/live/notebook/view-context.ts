import { createContext, useContext, useSyncExternalStore } from 'react'
import type { NotebookSearch } from '@pulpo/client-core/office/notebook/view'

/** Where the caret is in the active cell's editor, for the status bar. */
export interface CellCursor {
  key: string
  line: number
  column: number
  selected: number
}

/**
 * The active cell editor's caret, outside React state: it changes on every keystroke, and only
 * the status bar shows it, so nothing else re-renders. Reports wait for the next frame.
 */
export class CursorStore {
  private value: CellCursor | null = null
  private pending: CellCursor | null | undefined
  private frame = 0
  private readonly listeners = new Set<() => void>()

  get = (): CellCursor | null => this.value

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  report(cursor: CellCursor | null): void {
    this.pending = cursor
    if (this.frame) return
    const flush = () => {
      this.frame = 0
      const next = this.pending ?? null
      this.pending = undefined
      if (next?.key === this.value?.key && next?.line === this.value?.line && next?.column === this.value?.column && next?.selected === this.value?.selected) return
      this.value = next
      for (const listener of this.listeners) listener()
    }
    if (typeof requestAnimationFrame === 'function') this.frame = requestAnimationFrame(flush)
    else flush()
  }

  destroy(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
    this.listeners.clear()
  }
}

export function useCellCursor(store: CursorStore): CellCursor | null {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** What cells need from the notebook view beyond their own props. */
export interface NotebookView {
  lineNumbers: boolean
  wrap: boolean
  search: NotebookSearch
  cursor: CursorStore
  /** A cell editor's find keys: the notebook's find bar opens, or steps. */
  onFind: (key: string, command: 'find' | 'replace' | 'next' | 'previous') => void
  /** Hidden code (`key:source`) and outputs (`key:outputs`) a viewer opened for themselves; the document keeps them hidden. */
  revealed: ReadonlySet<string>
  reveal: (id: string) => void
  /** Cells whose long outputs show in full instead of scrolling. */
  expanded: ReadonlySet<string>
  toggleExpanded: (key: string) => void
  /** Gives the keyboard back to the notebook: the active cell's editor in edit mode, else the cell list. */
  focusNotebook: () => void
}

export const NotebookViewContext = createContext<NotebookView | null>(null)

export function useNotebookView(): NotebookView {
  const view = useContext(NotebookViewContext)
  if (!view) throw new Error('useNotebookView needs a NotebookViewContext')
  return view
}

/** Whether the find bar's current match is in a cell (it then shows the cell's source, Markdown too). */
export function useCurrentMatchIn(search: NotebookSearch, key: string): boolean {
  return useSyncExternalStore(search.subscribe, () => {
    const { matches, current } = search.getState()
    return matches[current]?.key === key
  })
}
