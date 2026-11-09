import { create } from 'zustand'
import { initialTabs, ROOT_LOCATION, type FilesLocation, type FilesTabsData } from './model'
import { clearStoredTabs, loadTabs, saveTabs } from './storage'

interface FilesTabsState extends FilesTabsData {
  /** Whose tabs these are (see `runtimeAccountKey`); null until an account's tabs are loaded. */
  owner: string | null
}

const EMPTY: FilesTabsState = { owner: null, tabs: [], activeId: '', closed: [] }

/** The Files tabs of this window, for the signed-in account. */
export const useFilesTabs = create<FilesTabsState>()(() => EMPTY)

/**
 * Loads an account's tabs once, when it is first needed in this window. Without any saved, the
 * window starts with one tab, showing `location` when the page opened on a Files location.
 */
export function ensureFilesTabs(owner: string, location?: FilesLocation | null): void {
  if (useFilesTabs.getState().owner === owner) return
  useFilesTabs.setState({ owner, ...(loadTabs(owner) ?? initialTabs(location ?? ROOT_LOCATION)) })
}

export function filesTabsData(): FilesTabsData {
  const { tabs, activeId, closed } = useFilesTabs.getState()
  return { tabs, activeId, closed }
}

/** Applies a change to the loaded tabs and saves it; returns the tabs after the change. */
export function updateFilesTabs(change: (data: FilesTabsData) => FilesTabsData): FilesTabsData {
  const { owner } = useFilesTabs.getState()
  const current = filesTabsData()
  if (!owner) return current
  const next = change(current)
  if (next === current) return current
  useFilesTabs.setState({ tabs: next.tabs, activeId: next.activeId, closed: next.closed })
  saveTabs(owner, next)
  return next
}

/** Forgets an account's tabs when it signs out of this device. */
export function forgetFilesTabs(owner: string): void {
  clearStoredTabs(owner)
  if (useFilesTabs.getState().owner === owner) useFilesTabs.setState(EMPTY)
}
