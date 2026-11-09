import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { SIDE_PANEL_PARAM } from '@/features/side-panel/store'
import { locationIsCurrent, mainViewContent, panelContentPath } from '@/features/side-panel/use-panel-actions'
import {
  activate,
  activeTab,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  cycleTab,
  duplicateTab,
  followLocation,
  moveTab,
  openTab,
  reopenClosed,
  ROOT_LOCATION,
  sameLocation,
  setPinned,
  tabForDigit,
  type FilesLocation,
  type FilesTab,
  type FilesTabsData,
  type FollowMode,
  type TabSnapshot,
} from './model'
import { ensureFilesTabs, filesTabsData, updateFilesTabs, useFilesTabs } from './store'

/** The panel the tabs control: the Files view below them. */
export const FILES_TAB_PANEL_ID = 'files-tab-panel'
export const filesTabElementId = (id: string): string => `files-tab-${id}`

/** The Files location a main-view path shows, or null when the main view is not in Files. */
export function filesLocationOf(pathname: string): FilesLocation | null {
  const content = mainViewContent(pathname)
  return content && content.kind !== 'attachment' ? content : null
}

export function locationPath(location: FilesLocation): string {
  return panelContentPath(location)
}

/** The tab a history entry was made for, when a tab switch made it. */
export function tabHint(state: unknown): string | undefined {
  const hint = state && typeof state === 'object' ? (state as { filesTab?: unknown }).filesTab : undefined
  return typeof hint === 'string' ? hint : undefined
}

/** The signed-in account's tabs key, loading its tabs (starting at `location`) the first time. */
export function useFilesTabsOwner(location?: FilesLocation | null): string | null {
  const userId = useAuth((state) => state.user?.id)
  const owner = userId ? runtimeAccountKey(userId) : null
  const initial = useRef(location)
  initial.current = location
  // Before paint, so the strip never shows another account's tabs or an empty frame.
  useLayoutEffect(() => {
    if (owner) ensureFilesTabs(owner, initial.current)
  }, [owner])
  return owner
}

export interface OpenTabOptions {
  /** Opens the tab without showing it, as a middle-click does in a browser. */
  background?: boolean
  /** Where the tab goes; by default after the active tab (and tabs opened from it). `end` puts it last. */
  index?: number | 'end'
  snapshot?: TabSnapshot | null
}

/**
 * Tab actions that also move the main view: showing a tab navigates to its location, marking the
 * history entry with the tab so back and forward come back to it.
 */
export function useFilesTabActions() {
  const navigate = useNavigate()
  const location = useLocation()
  // Refs keep the actions the same object across navigations (the router's navigate changes with
  // the path), so listeners subscribed with them, like the desktop menu, stay put.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const locationRef = useRef(location)
  locationRef.current = location

  const show = useCallback((tab: FilesTab | undefined, replace = false) => {
    if (!tab) return
    const params = new URLSearchParams(locationRef.current.search)
    // The side parameter is re-applied from the panel's store; never carry a stale one along.
    params.delete(SIDE_PANEL_PARAM)
    navigateRef.current({ pathname: locationPath(tab.location), search: params.toString() ? `?${params}` : '' }, { replace, state: { filesTab: tab.id } })
  }, [])

  return useMemo(() => {
    /** Shows the active tab when a change made another tab active, or moved the active one. */
    const showChange = (before: FilesTabsData, after: FilesTabsData, replace = false) => {
      const tab = activeTab(after)
      if (!tab) return
      const shown = filesLocationOf(locationRef.current.pathname)
      if (before.activeId === after.activeId && shown && sameLocation(shown, tab.location)) return
      show(tab, replace)
    }
    /** Takes the main view to a new chat, in place of the Files entry, keeping the side panel. */
    const leaveFiles = () => {
      const params = new URLSearchParams(locationRef.current.search)
      params.delete(SIDE_PANEL_PARAM)
      navigateRef.current({ pathname: '/', search: params.toString() ? `?${params}` : '' }, { replace: true })
    }
    const change = (apply: (data: FilesTabsData) => FilesTabsData, replace = false) => {
      const before = filesTabsData()
      const after = updateFilesTabs(apply)
      showChange(before, after, replace)
      return after
    }
    return {
      select: (id: string) => change((data) => activate(data, id)),
      newTab: (location: FilesLocation = ROOT_LOCATION, options: OpenTabOptions = {}) => {
        let opened: FilesTab | undefined
        const before = filesTabsData()
        const after = updateFilesTabs((data) => {
          const result = openTab(data, location, {
            activate: !options.background,
            index: options.index ?? (options.background ? undefined : 'end'),
            fromActive: options.background,
            snapshot: options.snapshot,
          })
          opened = result.tab
          return result.data
        })
        if (!options.background) showChange(before, after)
        return opened
      },
      /**
       * Opens a folder or file in a new tab: behind the current tab while Files shows, as a
       * middle-click opens a link in a browser, and otherwise shown in the main view.
       */
      openInNewTab: (location: FilesLocation, snapshot?: TabSnapshot | null) => {
        const filesShown = filesLocationOf(locationRef.current.pathname) !== null
        let opened: FilesTab | undefined
        const before = filesTabsData()
        const after = updateFilesTabs((data) => {
          const result = openTab(data, location, { activate: !filesShown, fromActive: true, snapshot })
          opened = result.tab
          return result.data
        })
        if (!filesShown) showChange(before, after)
        return opened
      },
      /**
       * Closing the tab that shows replaces its history entry, so Back does not reopen it. Closing
       * the last tab leaves Files for a new chat.
       */
      close: (id: string) => {
        const after = change((data) => closeTab(data, id), true)
        if (!after.tabs.length) leaveFiles()
        return after
      },
      closeOthers: (id: string) => change((data) => closeOtherTabs(data, id)),
      closeToRight: (id: string) => change((data) => closeTabsToRight(data, id), true),
      reopen: (at?: number) => change((data) => reopenClosed(data, at)),
      duplicate: (id: string) => change((data) => duplicateTab(data, id)),
      move: (id: string, index: number) => updateFilesTabs((data) => moveTab(data, id, index)),
      pin: (id: string, pinned: boolean) => updateFilesTabs((data) => setPinned(data, id, pinned)),
      cycle: (delta: number) => {
        const tab = cycleTab(filesTabsData(), delta)
        if (tab) change((data) => activate(data, tab.id))
      },
      digit: (digit: number) => {
        const tab = tabForDigit(filesTabsData(), digit)
        if (tab) change((data) => activate(data, tab.id))
      },
    }
  }, [show])
}

export type FilesTabActions = ReturnType<typeof useFilesTabActions>

/**
 * Keeps the tabs in step with the main view: every Files location it shows belongs to a tab (see
 * `followLocation`). Mounted with the Files views, so its first location is the way in.
 */
export function useFollowFilesLocation(owner: string | null): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const entering = useRef(true)
  const handled = useRef<string | null>(null)

  useEffect(() => {
    // A pending navigation renders first with the old location; wait for the router.
    if (!owner || !locationIsCurrent(location) || handled.current === location.key) return
    const shown = filesLocationOf(location.pathname)
    if (!shown) return
    handled.current = location.key
    const mode: FollowMode = entering.current ? 'enter' : navigationType === 'POP' ? 'pop' : 'push'
    entering.current = false
    const hint = tabHint(location.state)
    const after = updateFilesTabs((data) => followLocation(data, shown, mode, hint))
    // Every Files entry names the tab showing it, so back and forward return to that tab even
    // where another tab shows the same place. Only this entry's state changes; no navigation.
    if (hint !== after.activeId) markHistoryEntry(location.key, after.activeId)
  }, [location, navigationType, owner])
}

/** Records the tab in the browser's current history entry, when that entry is `key`'s. */
function markHistoryEntry(key: string, tabId: string): void {
  if (typeof window === 'undefined') return
  const state: unknown = window.history.state
  // The entry the page loaded on has no key of its own; the router calls it `default`.
  if (!state || typeof state !== 'object' || ((state as { key?: unknown }).key ?? 'default') !== key) return
  const { usr } = state as { usr?: unknown }
  try {
    window.history.replaceState({ ...state, usr: { ...(usr && typeof usr === 'object' ? usr : {}), filesTab: tabId } }, '')
  } catch { /* the history entry keeps no tab; back and forward then match tabs by place */ }
}

/**
 * Where the sidebar's Files button goes: back to the active tab as it was left, or, from inside
 * Files, to My files in the active tab, like a home button.
 */
export function useFilesNavTarget(): string {
  const location = useLocation()
  const owner = useFilesTabsOwner()
  const active = useFilesTabs((state) => state.owner === owner ? state.tabs.find((tab) => tab.id === state.activeId)?.location : undefined)
  if (filesLocationOf(location.pathname) || !active) return '/files'
  return locationPath(active)
}
