import { create } from 'zustand'
import {
  activate,
  activeTab,
  closeOtherTabs,
  closeTabs,
  closeTabsToRight,
  cycleTab,
  duplicateTab,
  moveTab,
  navigateActive,
  openTab,
  reopenClosed,
  ROOT_LOCATION,
  setPinned,
  tabForDigit,
  updateSnapshots,
  type FilesTab,
  type FilesTabsData,
  type TabSnapshot,
} from '@/features/files/tabs/model'
import { clearStoredPanelTabs, loadPanelTabs, savePanelTabs } from '@/features/files/tabs/storage'
import { mainViewShows, samePanelContent, type PanelContent } from './content'

export { parsePanelContent, samePanelContent, serializePanelContent, type PanelContent } from './content'

/** URL search parameter that mirrors the side panel, e.g. `?side=file:<id>`. */
export const SIDE_PANEL_PARAM = 'side'
export const SIDE_PANEL_MIN_WIDTH = 320
/** The main view never gets narrower than this beside the panel. */
export const MAIN_VIEW_MIN_WIDTH = 360
const WIDTH_STORAGE_KEY = 'pulpo.sidePanel.width'
export const DEFAULT_PANEL_WIDTH = 520

export type PanelTab = FilesTab<PanelContent>
export type PanelTabsData = FilesTabsData<PanelContent>

interface SidePanelState extends PanelTabsData {
  /**
   * What the panel shows now: its active tab's place, or null while the panel is hidden. Hiding
   * the panel keeps its tabs, so it comes back as it was.
   */
  content: PanelContent | null
  /** Whose tabs these are (see `runtimeAccountKey`); until an account's tabs load they are only kept in memory. */
  owner: string | null
  /** Without Files the panel holds one thing at a time, as it did before it had tabs. */
  tabsEnabled: boolean
  /** Shows `content` from outside the panel: in a tab already showing it, or in a new one after the active tab. */
  open: (content: PanelContent, snapshot?: TabSnapshot | null) => void
  /** Shows `content` in the panel's active tab, as browsing inside the panel does. */
  navigate: (content: PanelContent, snapshot?: TabSnapshot | null) => void
  /** Hides the panel; its tabs stay for the next time it opens. */
  close: () => void
  /** Hides the panel, or shows it again: its tabs, else the tabs closed last. */
  toggle: () => void
  /**
   * Whether the panel fits beside the main view. When it does not, the panel is not shown (it is
   * never laid over the main view) and things opened "to the side" open in the main view instead.
   */
  splitAvailable: boolean
  /** Whether this screen has a side panel at all; admin chat views do not. */
  enabled: boolean
}

const NO_TABS: PanelTabsData = { tabs: [], activeId: '', closed: [] }

function tabsOf(state: PanelTabsData): PanelTabsData {
  return { tabs: state.tabs, activeId: state.activeId, closed: state.closed }
}

/** The active tab's place, or null without tabs. */
function activeContent(data: PanelTabsData): PanelContent | null {
  return activeTab(data)?.location ?? null
}

/** Only the active tab, for a panel without tabs (Files turned off). */
function onlyActive(data: PanelTabsData): PanelTabsData {
  const active = activeTab(data)
  return active && data.tabs.length > 1 ? { ...data, tabs: [active], activeId: active.id } : data
}

/** A tab already showing `content` (the active one first), or a new one right after the active tab. */
function focusOrAdd(data: PanelTabsData, content: PanelContent, snapshot?: TabSnapshot | null): PanelTabsData {
  const active = activeTab(data)
  if (active && samePanelContent(active.location, content)) return data
  const match = data.tabs.find((tab) => samePanelContent(tab.location, content))
  if (match) return activate(data, match.id)
  const index = active ? data.tabs.indexOf(active) + 1 : 'end'
  return openTab(data, content, { index, snapshot }).data
}

/**
 * Applies a change to the panel's tabs. The panel then shows its active tab, if it was showing
 * before (or `show` asks for it), and hides once no tab is left.
 */
function changeTabs(change: (data: PanelTabsData) => PanelTabsData, show?: boolean): PanelTabsData {
  const state = useSidePanel.getState()
  const current = tabsOf(state)
  const changed = change(current)
  // Without Files the panel holds one thing at a time (reopening may bring back several).
  const next = state.tabsEnabled ? changed : onlyActive(changed)
  const shown = (show ?? state.content !== null) ? activeContent(next) : null
  // The same place keeps the same object, so the views and the URL mirror see no change.
  const content = shown && samePanelContent(shown, state.content) ? state.content : shown
  if (next === current && content === state.content) return current
  useSidePanel.setState({ ...tabsOf(next), content })
  return next
}

function showContent(content: PanelContent, snapshot: TabSnapshot | null | undefined, inPlace: boolean): void {
  const state = useSidePanel.getState()
  // Without tabs the panel shows one thing at a time: what opens replaces it.
  const replace = inPlace || !state.tabsEnabled
  changeTabs((data) => replace ? navigateActive(data, content, snapshot) : focusOrAdd(data, content, snapshot), true)
}

export const useSidePanel = create<SidePanelState>()((set, get) => ({
  ...NO_TABS,
  content: null,
  owner: null,
  tabsEnabled: true,
  splitAvailable: true,
  enabled: true,
  open: (content, snapshot) => showContent(content, snapshot, false),
  navigate: (content, snapshot) => showContent(content, snapshot, true),
  close: () => set({ content: null }),
  toggle: () => {
    const state = get()
    if (state.content) set({ content: null })
    else if (state.tabs.length) changeTabs((data) => data, true)
    else changeTabs((data) => reopenShowable(data), true)
  },
}))

// The tabs are saved whenever they change; showing or hiding the panel is the URL's to keep.
useSidePanel.subscribe((state, previous) => {
  if (!state.owner) return
  if (state.tabs === previous.tabs && state.activeId === previous.activeId && state.closed === previous.closed) return
  savePanelTabs(state.owner, tabsOf(state))
})

/**
 * Loads an account's panel tabs once, before the panel first shows. Whatever the panel already
 * shows (from the URL, before the account was known) joins them.
 */
export function ensurePanelTabs(owner: string): void {
  const state = useSidePanel.getState()
  if (state.owner === owner) return
  // Another account's panel is not carried over.
  const shown = state.owner === null ? state.content : null
  let data = loadPanelTabs(owner) ?? NO_TABS
  if (shown) data = focusOrAdd(data, shown)
  if (!state.tabsEnabled) data = onlyActive(data)
  useSidePanel.setState({ owner, ...data, content: shown ? activeContent(data) : null })
}

/** Forgets an account's panel tabs, which name its files, when it signs out of this device. */
export function forgetPanelTabs(owner: string): void {
  clearStoredPanelTabs(owner)
  if (useSidePanel.getState().owner === owner) useSidePanel.setState({ ...NO_TABS, owner: null, content: null })
}

/** Turns the panel's tabs on or off with Files; without them only the active tab is kept. */
export function setPanelTabsEnabled(enabled: boolean): void {
  const state = useSidePanel.getState()
  if (state.tabsEnabled === enabled) return
  useSidePanel.setState(enabled ? { tabsEnabled: enabled } : { tabsEnabled: enabled, ...onlyActive(tabsOf(state)) })
}

export function panelTabsData(): PanelTabsData {
  return tabsOf(useSidePanel.getState())
}

/** Closes tabs; the panel hides once the last one closes, rather than opening a new one. */
function closePanelTabs(ids: Iterable<string>): PanelTabsData {
  return changeTabs((data) => closeTabs(data, ids))
}

/**
 * Reopens closed tabs (the group at `at`, or the newest one with something to show), leaving out
 * the main view's own file or attachment, which is open in one view at a time; those stay closed.
 */
function reopenShowable(data: PanelTabsData, at?: number): PanelTabsData {
  const showable = (entry: PanelTabsData['closed'][number]) => entry.tabs.filter(({ tab }) => !mainViewShows(tab.location))
  let index = at ?? data.closed.length - 1
  if (at === undefined) while (index >= 0 && !showable(data.closed[index]!).length) index--
  const entry = data.closed[index]
  if (!entry) return data
  const tabs = showable(entry)
  if (!tabs.length) return data
  const closed = tabs.length === entry.tabs.length ? data.closed : data.closed.map((group, at) => at === index ? { tabs } : group)
  return reopenClosed({ ...data, closed }, index)
}

/** Every tab showing `content`, the active one first. */
function tabsShowing(content: PanelContent): PanelTab[] {
  const data = panelTabsData()
  const active = activeTab(data)
  const showing = data.tabs.filter((tab) => samePanelContent(tab.location, content))
  return active && showing.includes(active) ? [active, ...showing.filter((tab) => tab !== active)] : showing
}

/**
 * The panel's tab actions, the same object for the life of the page (the desktop menu and the
 * strip subscribe with it). Only the strip's own actions and the desktop keys use them; the rest
 * of the app opens things with `open` and browses with `navigate`.
 */
export const panelTabActions = {
  select: (id: string) => { changeTabs((data) => activate(data, id)) },
  /** Opens a new tab (My files by default) at the end, or at `index`, and shows it. */
  newTab: (location: PanelContent = ROOT_LOCATION, options: { index?: number } = {}) => {
    changeTabs((data) => openTab(data, location, { index: options.index ?? 'end' }).data, true)
  },
  /** Opens a tab behind the active one, as a middle-click does in a browser. */
  openInBackground: (location: PanelContent, snapshot?: TabSnapshot | null) => {
    changeTabs((data) => openTab(data, location, { activate: false, fromActive: true, snapshot }).data)
  },
  close: (id: string) => closePanelTabs([id]),
  closeOthers: (id: string) => { changeTabs((data) => closeOtherTabs(data, id)) },
  closeToRight: (id: string) => { changeTabs((data) => closeTabsToRight(data, id)) },
  reopen: (at?: number) => { changeTabs((data) => reopenShowable(data, at), true) },
  duplicate: (id: string) => { changeTabs((data) => duplicateTab(data, id)) },
  move: (id: string, index: number) => { changeTabs((data) => moveTab(data, id, index)) },
  pin: (id: string, pinned: boolean) => { changeTabs((data) => setPinned(data, id, pinned)) },
  cycle: (delta: number) => {
    const tab = cycleTab(panelTabsData(), delta)
    if (tab) changeTabs((data) => activate(data, tab.id))
  },
  digit: (digit: number) => {
    const tab = tabForDigit(panelTabsData(), digit)
    if (tab) changeTabs((data) => activate(data, tab.id))
  },
  updateSnapshots: (nodes: ReadonlyMap<string, TabSnapshot>) => { changeTabs((data) => updateSnapshots(data, nodes)) },
  /**
   * Closes the tab showing `content`, as the panel's own Close and "Open in main view" do for
   * what it shows: the active tab when it does, and the panel hides after its last tab.
   */
  closeShowing: (content: PanelContent) => {
    const [tab] = tabsShowing(content)
    if (tab) closePanelTabs([tab.id])
    else if (samePanelContent(useSidePanel.getState().content, content)) useSidePanel.getState().close()
  },
  /** Closes every tab showing `content`, when the main view opens it: one document opens in one view. */
  remove: (content: PanelContent) => {
    const tabs = tabsShowing(content)
    if (tabs.length) closePanelTabs(tabs.map((tab) => tab.id))
    else if (samePanelContent(useSidePanel.getState().content, content)) useSidePanel.getState().close()
  },
}

/** Whether a panel tab shows `content`. */
export function panelShows(state: PanelTabsData, content: PanelContent): boolean {
  return state.tabs.some((tab) => samePanelContent(tab.location, content))
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
