import { create } from 'zustand'

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

interface SidePanelState {
  /** What the panel shows: its active tab, or null while it is closed. */
  content: PanelContent | null
  /**
   * The panel's open tabs, in order, including `content`. Kept while the panel is closed, so it
   * can be reopened as it was; opening anything else in a closed panel starts over with that.
   */
  tabs: PanelContent[]
  /** The last thing shown, so the panel can be reopened after closing it. */
  lastContent: PanelContent | null
  /** Shows `content` in a tab of its own, or the tab already showing it. */
  open: (content: PanelContent) => void
  /**
   * Shows `content` in place of the active tab, as browsing in the panel does (a folder, a file
   * in it, the folders above it), or switches to the tab already showing it.
   */
  show: (content: PanelContent) => void
  /** Closes one tab; the next tab, or else the previous, takes its place. The last one closes the panel. */
  closeTab: (content: PanelContent) => void
  /** Closes the panel, keeping its tabs for reopening. */
  close: () => void
  toggle: () => void
  /**
   * Whether the panel fits beside the main view. When it does not, the panel is not shown (it is
   * never laid over the main view) and things opened "to the side" open in the main view instead.
   */
  splitAvailable: boolean
  /** Whether this screen has a side panel at all; admin chat views do not. */
  enabled: boolean
}

const TABS_STORAGE_KEY = 'pulpo.sidePanel.tabs'

/** The tabs of the last panel in this browser tab, so a reload reopens all of them. */
function readTabs(): PanelContent[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(TABS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return dedupeTabs(saved.map((value) => typeof value === 'string' ? parsePanelContent(value) : null).filter((tab) => tab !== null))
  } catch { return [] }
}

function writeTabs(tabs: PanelContent[]): void {
  try { sessionStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs.map(serializePanelContent))) } catch { /* the tabs are optional */ }
}

function dedupeTabs(tabs: PanelContent[]): PanelContent[] {
  const seen = new Set<string | null>()
  return tabs.filter((tab) => {
    const key = serializePanelContent(tab)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const tabIndex = (tabs: PanelContent[], content: PanelContent | null) => tabs.findIndex((tab) => samePanelContent(tab, content))

export const useSidePanel = create<SidePanelState>()((set, get) => ({
  content: null,
  tabs: readTabs(),
  lastContent: null,
  splitAvailable: true,
  enabled: true,
  open: (content) => {
    const { content: active, tabs } = get()
    if (tabIndex(tabs, content) >= 0) set({ content, lastContent: content })
    // A closed panel opens with only this; an open one adds it after the tab in view.
    else if (!active) set({ content, lastContent: content, tabs: [content] })
    else {
      const next = [...tabs]
      next.splice(tabIndex(tabs, active) + 1, 0, content)
      set({ content, lastContent: content, tabs: next })
    }
  },
  show: (content) => {
    const { content: active, tabs } = get()
    const at = tabIndex(tabs, active)
    if (!active || at < 0 || tabIndex(tabs, content) >= 0) return get().open(content)
    set({ content, lastContent: content, tabs: tabs.with(at, content) })
  },
  closeTab: (content) => {
    const { content: active, tabs } = get()
    const at = tabIndex(tabs, content)
    if (at < 0) return
    const next = tabs.toSpliced(at, 1)
    if (!samePanelContent(active, content)) return set({ tabs: next })
    const replacement = next[at] ?? next[at - 1] ?? null
    set({ content: replacement, tabs: next, lastContent: replacement ?? get().lastContent })
  },
  close: () => set({ content: null }),
  toggle: () => {
    const { content, lastContent, tabs } = get()
    if (content) set({ content: null })
    else if (lastContent) set({ content: lastContent, tabs: tabIndex(tabs, lastContent) >= 0 ? tabs : [lastContent] })
  },
}))

useSidePanel.subscribe((state, previous) => { if (state.tabs !== previous.tabs) writeTabs(state.tabs) })

export function samePanelContent(left: PanelContent | null, right: PanelContent | null): boolean {
  return serializePanelContent(left) === serializePanelContent(right)
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function serializePanelContent(content: PanelContent | null): string | null {
  if (!content) return null
  if (content.kind === 'file') return `file:${content.id}`
  if (content.kind === 'attachment') return `attachment:${content.id}`
  return `folder:${content.id ?? 'root'}`
}

export function parsePanelContent(value: string | null): PanelContent | null {
  if (!value) return null
  const lower = value.toLowerCase()
  const file = new RegExp(`^file:(${UUID})$`).exec(lower)
  if (file) return { kind: 'file', id: file[1]! }
  const attachment = new RegExp(`^attachment:(${UUID})$`).exec(lower)
  if (attachment) return { kind: 'attachment', id: attachment[1]! }
  const folder = new RegExp(`^folder:(root|trash|trash:${UUID}|${UUID})$`).exec(lower)
  if (folder) return { kind: 'folder', id: folder[1] === 'root' ? null : folder[1]! }
  return null
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
