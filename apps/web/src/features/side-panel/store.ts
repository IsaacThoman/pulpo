import { create } from 'zustand'
import { activeTab, addTab, navigateContent, NO_TABS, openContent, moveTab, parsePanelContent, readTabs, removeContent, removeTabs, sameContent, serializePanelContent, writeTabs, type PaneTabs } from './pane-tabs'

export { parsePanelContent, serializePanelContent }

/** URL search parameter that mirrors the side panel, e.g. `?side=file:<id>`. */
export const SIDE_PANEL_PARAM = 'side'
export const SIDE_PANEL_MIN_WIDTH = 320
/** The main view never gets narrower than this beside the panel. */
export const MAIN_VIEW_MIN_WIDTH = 360
const WIDTH_STORAGE_KEY = 'pulpo.sidePanel.width'
export const DEFAULT_PANEL_WIDTH = 520

/**
 * What the side panel shows: a file, a folder of the Files browser (`null` is My files; the trash
 * and trashed folders use the references in features/trash/folder), or a chat attachment. Chats always live in the main view; the panel holds what they work on.
 */
export type PanelContent =
  | { kind: 'file'; id: string }
  | { kind: 'folder'; id: string | null }
  | { kind: 'attachment'; id: string }

const TABS_STORAGE_KEY = 'pulpo.sidePanel.tabs'

interface SidePanelState extends PaneTabs {
  /** What the panel shows: its active tab's content, or null while it is closed or hidden. */
  content: PanelContent | null
  /** Hidden with Cmd/Ctrl+\\, keeping its tabs. */
  hidden: boolean
  /** The tabs last closed with the panel, so Cmd/Ctrl+\\ can bring them back. */
  closed: PaneTabs
  /** Whose tabs are kept on this device. */
  userId: string | null
  /** Shows something opened from elsewhere: in the tab already showing it, else a new tab. */
  open: (content: PanelContent) => void
  /** Browsing inside the panel: the active tab moves to `content`. */
  navigate: (content: PanelContent) => void
  /** A new tab after the active one (or `after`); `background` keeps the active tab showing. */
  openTab: (content: PanelContent, options?: { background?: boolean; after?: string }) => void
  activate: (id: string) => void
  /** Closes tabs; closing the last closes the panel. */
  closeTabs: (ids: Iterable<string>) => void
  moveTab: (id: string, index: number) => void
  /** Closes the tabs showing `content`, e.g. once the main view shows it instead. */
  removeContent: (content: PanelContent) => void
  /** Closes the panel and its tabs. */
  close: () => void
  /** Hides or shows the panel with its tabs, or reopens the tabs last closed. */
  toggle: () => void
  /** Loads the account's tabs kept on this device; a link's `content` reopens them with it active. */
  restore: (userId: string, content: PanelContent | null) => void
  /**
   * Whether the panel fits beside the main view. When it does not, the panel is not shown (it is
   * never laid over the main view) and things opened "to the side" open in the main view instead.
   */
  splitAvailable: boolean
  /** Whether this screen has a side panel at all; admin chat views do not. */
  enabled: boolean
}

/** The panel showing `tabs`, with the content and visibility that follow from them. */
function showing(tabs: PaneTabs, hidden = false): Pick<SidePanelState, 'tabs' | 'activeId' | 'content' | 'hidden'> {
  const content = tabs.tabs.length && !hidden ? activeTab(tabs)?.content ?? null : null
  return { tabs: tabs.tabs, activeId: tabs.activeId, content, hidden: hidden && tabs.tabs.length > 0 }
}

export const useSidePanel = create<SidePanelState>()((set, get) => {
  /** Applies a change to the tabs; opening anything shows a hidden panel again. */
  const change = (next: (tabs: PaneTabs) => PaneTabs, reveal = true) => {
    const state = get()
    const tabs = next({ tabs: state.tabs, activeId: state.activeId })
    set(showing(tabs, reveal ? false : state.hidden))
  }
  return {
    ...NO_TABS,
    content: null,
    hidden: false,
    closed: NO_TABS,
    userId: null,
    splitAvailable: true,
    enabled: true,
    open: (content) => change((tabs) => openContent(tabs, content)),
    navigate: (content) => change((tabs) => navigateContent(tabs, content)),
    openTab: (content, options) => change((tabs) => addTab(tabs, content, options)),
    activate: (id) => change((tabs) => tabs.tabs.some((tab) => tab.id === id) ? { ...tabs, activeId: id } : tabs),
    closeTabs: (ids) => {
      const state = get()
      const next = removeTabs(state, new Set(ids))
      // Closing the last tab closes the panel; Cmd/Ctrl+\\ brings it back.
      set({ ...showing(next, state.hidden), ...(next.tabs.length ? {} : { closed: { tabs: state.tabs, activeId: state.activeId } }) })
    },
    moveTab: (id, index) => change((tabs) => moveTab(tabs, id, index), false),
    removeContent: (content) => {
      const state = get()
      if (!state.tabs.some((tab) => sameContent(tab.content, content))) return
      set(showing(removeContent(state, content), state.hidden))
    },
    close: () => {
      const state = get()
      if (state.tabs.length) set({ ...showing(NO_TABS), closed: { tabs: state.tabs, activeId: state.activeId } })
    },
    toggle: () => {
      const state = get()
      if (state.tabs.length) set(showing(state, !state.hidden))
      else if (state.closed.tabs.length) set({ ...showing(state.closed), closed: NO_TABS })
    },
    restore: (userId, content) => {
      const state = get()
      if (state.userId === userId) return
      const saved = readTabs(TABS_STORAGE_KEY, userId)
      const match = content && saved.tabs.find((tab) => sameContent(tab.content, content))
      if (match) set({ userId, ...showing({ ...saved, activeId: match.id }), closed: NO_TABS })
      else {
        set({ userId, closed: saved })
        if (content) get().open(content)
      }
    },
  }
})

// The tabs are kept on this device, so a reload (or a link back) reopens them.
useSidePanel.subscribe((state, previous) => {
  if (state.userId && (state.tabs !== previous.tabs || state.activeId !== previous.activeId)) {
    writeTabs(TABS_STORAGE_KEY, state.userId, state)
  }
})

export function samePanelContent(left: PanelContent | null, right: PanelContent | null): boolean {
  return serializePanelContent(left) === serializePanelContent(right)
}

/** Whether a panel and the main view both fit, at their minimum widths, in `available` pixels. */
export function splitFits(available: number): boolean {
  return available >= SIDE_PANEL_MIN_WIDTH + MAIN_VIEW_MIN_WIDTH
}

/** Keeps both views usable: the panel is at least its minimum and leaves the main view its own. */
export function clampPanelWidth(width: number, available: number): number {
  return Math.round(Math.min(Math.max(width, SIDE_PANEL_MIN_WIDTH), Math.max(SIDE_PANEL_MIN_WIDTH, available - MAIN_VIEW_MIN_WIDTH)))
}

export function readPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) return saved
  } catch { /* the preference is optional */ }
  return DEFAULT_PANEL_WIDTH
}

export function writePanelWidth(width: number): void {
  try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width))) } catch { /* the preference is optional */ }
}
