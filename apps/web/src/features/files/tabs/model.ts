import type { FileNode } from '@pulpo/contracts'

/**
 * What a Files tab shows: a folder of the Files browser (`null` is My files; the trash and trashed
 * folders use the references in features/trash/folder) or a file. The same places the side panel
 * shows, less chat attachments, which are not part of Files.
 */
export type FilesLocation = { kind: 'folder'; id: string | null } | { kind: 'file'; id: string }

/** The last name and look a tab's folder or file was seen with, so a tab reads right before its view loads. */
export type TabSnapshot = Pick<FileNode, 'kind' | 'name' | 'mimeType'> & Partial<Pick<FileNode, 'systemRole' | 'color' | 'icon'>>

export interface FilesTab {
  id: string
  location: FilesLocation
  pinned: boolean
  snapshot: TabSnapshot | null
  /** The tab this one was opened from, so tabs opened from one place line up after it, as in browsers. */
  openerId?: string
}

/** Tabs closed together (one tab, or "Close other tabs"), reopened together at their old places. */
export interface ClosedTabs {
  tabs: { tab: FilesTab; index: number }[]
}

export interface FilesTabsData {
  tabs: FilesTab[]
  activeId: string
  /** Most recently closed last. */
  closed: ClosedTabs[]
}

/**
 * How the main view arrived at a Files location: `enter` is the first location after coming from
 * elsewhere in the app (or loading the page), `pop` is back/forward, `push` is any other navigation.
 */
export type FollowMode = 'enter' | 'pop' | 'push'

export const MAX_TABS = 100
export const MAX_CLOSED = 25
export const ROOT_LOCATION: FilesLocation = { kind: 'folder', id: null }

export function newTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

export function sameLocation(left: FilesLocation, right: FilesLocation): boolean {
  return left.kind === right.kind && left.id === right.id
}

/** The stored folder or file a location shows, if any: not My files or the trash itself. */
export function locationNodeId(location: FilesLocation): string | null {
  if (location.kind === 'file') return location.id
  if (location.id === null || location.id === 'trash') return null
  return location.id.startsWith('trash:') ? location.id.slice('trash:'.length) : location.id
}

export function createTab(location: FilesLocation, options: { pinned?: boolean; snapshot?: TabSnapshot | null; openerId?: string; id?: string } = {}): FilesTab {
  return {
    id: options.id ?? newTabId(),
    location,
    pinned: options.pinned ?? false,
    snapshot: options.snapshot ?? null,
    ...(options.openerId ? { openerId: options.openerId } : {}),
  }
}

export function initialTabs(location: FilesLocation = ROOT_LOCATION): FilesTabsData {
  const tab = createTab(location)
  return { tabs: [tab], activeId: tab.id, closed: [] }
}

export function pinnedCount(tabs: FilesTab[]): number {
  let count = 0
  while (count < tabs.length && tabs[count]!.pinned) count++
  return count
}

/** Where a tab may sit: pinned tabs stay together at the start, the rest follow them. */
export function groupRange(tabs: FilesTab[], pinned: boolean): { start: number; end: number } {
  const pins = pinnedCount(tabs)
  return pinned ? { start: 0, end: Math.max(0, pins - 1) } : { start: pins, end: Math.max(pins, tabs.length - 1) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function activeTab(data: FilesTabsData): FilesTab | undefined {
  return data.tabs.find((tab) => tab.id === data.activeId) ?? data.tabs[0]
}

export function activate(data: FilesTabsData, id: string): FilesTabsData {
  if (data.activeId === id || !data.tabs.some((tab) => tab.id === id)) return data
  return { ...data, activeId: id }
}

/**
 * Where a new tab goes. Without an index it follows the active tab and any tabs already opened
 * from it, the way links opened in new tabs line up in a browser; `end` puts it last.
 */
function insertionIndex(data: FilesTabsData, tab: FilesTab, index: number | 'end' | undefined): number {
  const { start } = groupRange(data.tabs, tab.pinned)
  const pins = pinnedCount(data.tabs)
  const end = tab.pinned ? pins : data.tabs.length
  if (index === 'end') return end
  if (index !== undefined) return clamp(index, start, end)
  const opener = data.tabs.findIndex((candidate) => candidate.id === tab.openerId)
  if (opener < 0) return end
  let at = opener + 1
  while (at < data.tabs.length && data.tabs[at]!.openerId === tab.openerId) at++
  return clamp(at, start, end)
}

function pushClosed(closed: ClosedTabs[], entry: ClosedTabs): ClosedTabs[] {
  return entry.tabs.length ? [...closed, entry].slice(-MAX_CLOSED) : closed
}

/**
 * Keeps the window within `MAX_TABS`: the leftmost unpinned tab that is not showing (and not in
 * `keep`) closes, and can be reopened like any closed tab.
 */
function makeRoom(data: FilesTabsData, extra: number, keep: ReadonlySet<string> = new Set()): FilesTabsData {
  if (data.tabs.length + extra <= MAX_TABS) return data
  const tabs = [...data.tabs]
  let closed = data.closed
  while (tabs.length + extra > MAX_TABS) {
    const index = tabs.findIndex((tab) => !tab.pinned && tab.id !== data.activeId && !keep.has(tab.id))
    if (index < 0) break
    const [tab] = tabs.splice(index, 1)
    closed = pushClosed(closed, { tabs: [{ tab: tab!, index }] })
  }
  return { ...data, tabs, closed }
}

export function openTab(
  data: FilesTabsData,
  location: FilesLocation,
  options: { index?: number | 'end'; activate?: boolean; snapshot?: TabSnapshot | null; fromActive?: boolean; pinned?: boolean } = {},
): { data: FilesTabsData; tab: FilesTab } {
  const tab = createTab(location, {
    snapshot: options.snapshot ?? null,
    pinned: options.pinned ?? false,
    openerId: options.fromActive ? data.activeId : undefined,
  })
  const base = makeRoom(data, 1, new Set(tab.openerId ? [tab.openerId] : []))
  const index = insertionIndex(base, tab, options.index)
  const tabs = [...base.tabs.slice(0, index), tab, ...base.tabs.slice(index)]
  return { data: { ...base, tabs, activeId: options.activate === false ? base.activeId : tab.id }, tab }
}

/** Whether there is such a tab to close. Every tab can close, the last one too (see `closeTabs`). */
export function canCloseTab(data: FilesTabsData, id: string): boolean {
  return data.tabs.some((tab) => tab.id === id)
}

/** The tab that shows once `ids` are gone, if the active tab is among them: the next one to the right, else to the left. */
function successor(tabs: FilesTab[], activeId: string, removed: Set<string>): string | null {
  if (!removed.has(activeId)) return activeId
  const index = tabs.findIndex((tab) => tab.id === activeId)
  for (let at = index + 1; at < tabs.length; at++) if (!removed.has(tabs[at]!.id)) return tabs[at]!.id
  for (let at = index - 1; at >= 0; at--) if (!removed.has(tabs[at]!.id)) return tabs[at]!.id
  return null
}

/**
 * Closes `ids`. Closing every tab leaves none, as closing a browser window's last tab closes the
 * window: the main view then leaves Files for a new chat, and Files opens a new tab when it comes back.
 */
export function closeTabs(data: FilesTabsData, ids: Iterable<string>): FilesTabsData {
  const removed = new Set(ids)
  const closing = data.tabs.flatMap((tab, index) => removed.has(tab.id) ? [{ tab, index }] : [])
  if (!closing.length) return data
  const closed = pushClosed(data.closed, { tabs: closing })
  const tabs = data.tabs.filter((tab) => !removed.has(tab.id))
  if (!tabs.length) return { tabs: [], activeId: '', closed }
  return { tabs, activeId: successor(data.tabs, data.activeId, removed) ?? tabs[0]!.id, closed }
}

export function closeTab(data: FilesTabsData, id: string): FilesTabsData {
  return closeTabs(data, [id])
}

/** Closes every other tab except pinned ones, and shows the one kept. */
export function closeOtherTabs(data: FilesTabsData, id: string): FilesTabsData {
  if (!data.tabs.some((tab) => tab.id === id)) return data
  const next = closeTabs(data, data.tabs.filter((tab) => tab.id !== id && !tab.pinned).map((tab) => tab.id))
  return activate(next, id)
}

/** Closes the unpinned tabs after `id`; if the active tab was among them, `id` shows. */
export function closeTabsToRight(data: FilesTabsData, id: string): FilesTabsData {
  const index = data.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return data
  const ids = data.tabs.slice(index + 1).filter((tab) => !tab.pinned).map((tab) => tab.id)
  const activeClosed = ids.includes(data.activeId)
  const next = closeTabs(data, ids)
  return activeClosed ? activate(next, id) : next
}

/** Reopens the most recently closed tabs (or the closed group at `at`) where they were, showing the last of them. */
export function reopenClosed(data: FilesTabsData, at = data.closed.length - 1): FilesTabsData {
  const entry = data.closed[at]
  if (!entry) return data
  const closed = data.closed.filter((_, index) => index !== at)
  let tabs = [...data.tabs]
  const taken = new Set(tabs.map((tab) => tab.id))
  let last: string | null = null
  for (const { tab, index } of [...entry.tabs].sort((left, right) => left.index - right.index)) {
    // A tab reopened in another session may share its id with a live tab; give it a fresh one.
    const restored = taken.has(tab.id) ? { ...tab, id: newTabId() } : tab
    taken.add(restored.id)
    const pins = pinnedCount(tabs)
    const position = restored.pinned ? clamp(index, 0, pins) : clamp(index, pins, tabs.length)
    tabs = [...tabs.slice(0, position), restored, ...tabs.slice(position)]
    last = restored.id
  }
  const reopened = new Set(entry.tabs.map(({ tab }) => tab.id).concat(last ? [last] : []))
  const activeId = last ?? data.activeId
  // Making room never closes a tab just reopened.
  return makeRoom({ tabs, activeId, closed }, 0, reopened)
}

/** Moves a tab to `index`, kept within its group (pinned or not). */
export function moveTab(data: FilesTabsData, id: string, index: number): FilesTabsData {
  const from = data.tabs.findIndex((tab) => tab.id === id)
  if (from < 0) return data
  const tab = data.tabs[from]!
  const { start, end } = groupRange(data.tabs, tab.pinned)
  const to = clamp(index, start, end)
  if (to === from) return data
  const tabs = data.tabs.filter((candidate) => candidate.id !== id)
  tabs.splice(to, 0, tab)
  return { ...data, tabs }
}

/** Pins a tab (it joins the end of the pinned tabs) or unpins it (it leads the unpinned ones). */
export function setPinned(data: FilesTabsData, id: string, pinned: boolean): FilesTabsData {
  const tab = data.tabs.find((candidate) => candidate.id === id)
  if (!tab || tab.pinned === pinned) return data
  const rest = data.tabs.filter((candidate) => candidate.id !== id)
  const at = pinnedCount(rest)
  const changed = { ...tab, pinned }
  return { ...data, tabs: [...rest.slice(0, at), changed, ...rest.slice(at)] }
}

/** A copy of a tab right after it, shown, as a browser's Duplicate does. */
export function duplicateTab(data: FilesTabsData, id: string): FilesTabsData {
  const source = data.tabs.find((tab) => tab.id === id)
  if (!source) return data
  // Room is made first, so the copy still lands right after its source.
  const base = makeRoom(data, 1, new Set([id]))
  const index = base.tabs.findIndex((tab) => tab.id === id)
  return openTab(base, source.location, { index: index + 1, snapshot: source.snapshot, pinned: source.pinned }).data
}

/** Shows `location` in the active tab, as following a link does. */
export function navigateActive(data: FilesTabsData, location: FilesLocation, snapshot?: TabSnapshot | null): FilesTabsData {
  const current = activeTab(data)
  // With every tab closed, Files starts again with one, keeping what can be reopened.
  if (!current) return { ...initialTabs(location), closed: data.closed }
  if (sameLocation(current.location, location)) return data
  return {
    ...data,
    activeId: current.id,
    tabs: data.tabs.map((tab) => tab.id === current.id ? { ...tab, location, snapshot: snapshot ?? null } : tab),
  }
}

/**
 * Brings the tabs in line with the location the main view now shows.
 *
 * - A history entry made by a tab switch names its tab (`hint`); that tab shows it.
 * - Otherwise the active tab already showing it needs nothing.
 * - Coming back to Files, and back/forward, show a tab already at that place rather than a copy.
 * - Anything else (following a folder, a breadcrumb, a sidebar link) happens in the active tab.
 */
export function followLocation(data: FilesTabsData, location: FilesLocation, mode: FollowMode, hint?: string): FilesTabsData {
  const hinted = hint ? data.tabs.find((tab) => tab.id === hint) : undefined
  if (hinted) {
    const shown = activate(data, hinted.id)
    return navigateActive(shown, location)
  }
  const current = activeTab(data)
  if (current && sameLocation(current.location, location)) return current.id === data.activeId ? data : { ...data, activeId: current.id }
  if (mode !== 'push') {
    const match = data.tabs.find((tab) => sameLocation(tab.location, location))
    if (match) return activate(data, match.id)
  }
  return navigateActive(data, location)
}

/** The tab `delta` places from the active one, wrapping around, as Ctrl+Tab does. */
export function cycleTab(data: FilesTabsData, delta: number): FilesTab | undefined {
  if (!data.tabs.length) return undefined
  const index = Math.max(0, data.tabs.findIndex((tab) => tab.id === data.activeId))
  const next = ((index + delta) % data.tabs.length + data.tabs.length) % data.tabs.length
  return data.tabs[next]
}

/** Cmd/Ctrl+1–8 show those tabs; 9 shows the last, as in browsers. */
export function tabForDigit(data: FilesTabsData, digit: number): FilesTab | undefined {
  if (digit === 9) return data.tabs.at(-1)
  return data.tabs[digit - 1]
}

function snapshotEquals(left: TabSnapshot | null, right: TabSnapshot): boolean {
  return Boolean(left)
    && left!.name === right.name
    && left!.kind === right.kind
    && (left!.mimeType ?? null) === (right.mimeType ?? null)
    && (left!.systemRole ?? null) === (right.systemRole ?? null)
    && (left!.color ?? null) === (right.color ?? null)
    && (left!.icon ?? null) === (right.icon ?? null)
}

export function toSnapshot(node: TabSnapshot): TabSnapshot {
  return {
    kind: node.kind,
    name: node.name,
    mimeType: node.mimeType ?? null,
    ...(node.systemRole ? { systemRole: node.systemRole } : {}),
    ...(node.color ? { color: node.color } : {}),
    ...(node.icon ? { icon: node.icon } : {}),
  }
}

/** Records what the tabs' folders and files look like now (by node id); unchanged data is returned as is. */
export function updateSnapshots(data: FilesTabsData, nodes: ReadonlyMap<string, TabSnapshot>): FilesTabsData {
  let changed = false
  const tabs = data.tabs.map((tab) => {
    const id = locationNodeId(tab.location)
    const node = id ? nodes.get(id) : undefined
    if (!node || snapshotEquals(tab.snapshot, node)) return tab
    changed = true
    return { ...tab, snapshot: toSnapshot(node) }
  })
  return changed ? { ...data, tabs } : data
}
