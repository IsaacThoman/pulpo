import { useEffect, useLayoutEffect, useRef } from 'react'

const DEFAULT_DOCUMENT_TITLE = 'Pulpo'

/** "Files – Pulpo": a page's name followed by the app's. */
export function pageTitle(...parts: Array<string | null | undefined>): string {
  return [...parts.filter((part): part is string => Boolean(part?.trim())), DEFAULT_DOCUMENT_TITLE].join(' – ')
}

interface TitleEntry {
  title: string | null
  /** Route-level titles only show while no view has a title of its own. */
  fallback: boolean
}

// Every mounted title, oldest first. The newest specific title wins, then the newest fallback.
const entries: TitleEntry[] = []

function applyTitle() {
  const pick = (fallback: boolean) => entries.findLast((entry) => entry.fallback === fallback && entry.title)?.title
  const next = pick(false) ?? pick(true) ?? DEFAULT_DOCUMENT_TITLE
  if (document.title !== next) document.title = next
}

function useTitleEntry(title: string | null | undefined, fallback: boolean) {
  const entry = useRef<TitleEntry | null>(null)
  const value = title && title.trim().length > 0 ? title : null

  // Registered in a layout effect so a view's own title is in place before the browser paints,
  // whichever of the route and the view mounts first.
  useLayoutEffect(() => {
    const current: TitleEntry = { title: null, fallback }
    entry.current = current
    entries.push(current)
    return () => {
      entries.splice(entries.indexOf(current), 1)
      entry.current = null
      applyTitle()
    }
  }, [fallback])

  useEffect(() => {
    if (!entry.current) return
    entry.current.title = value
    applyTitle()
  }, [value, fallback])
}

/** Sets the tab's title while the calling view is mounted; empty titles show "Pulpo". */
export function useDocumentTitle(title?: string | null): void {
  useTitleEntry(title, false)
}

/**
 * The title for the current route, shown while no view sets one of its own with
 * `useDocumentTitle` (a chat's title, an open document's name).
 */
export function useRouteDocumentTitle(title?: string | null): void {
  useTitleEntry(title, true)
}
