import { parsePanelContent, serializePanelContent } from '@/features/side-panel/store'
import { isDesktopRuntime } from '@/lib/runtime'
import { MAX_CLOSED, MAX_TABS, type ClosedTabs, type FilesLocation, type FilesTab, type FilesTabsData, type TabSnapshot } from './model'

const STORAGE_PREFIX = 'pulpo.files.tabs:'
const VERSION = 1

/** The storage key of one account's tabs (the desktop app keys accounts by instance too). */
export function tabsStorageKey(owner: string): string {
  return `${STORAGE_PREFIX}${owner}`
}

interface StoredTab {
  id: string
  location: string
  pinned?: boolean
  snapshot?: TabSnapshot | null
  openerId?: string
}

interface StoredTabs {
  v: number
  tabs: StoredTab[]
  activeId: string
  closed?: { tabs: { tab: StoredTab; index: number }[] }[]
}

function storeTab(tab: FilesTab): StoredTab {
  return {
    id: tab.id,
    location: serializePanelContent(tab.location)!,
    ...(tab.pinned ? { pinned: true } : {}),
    ...(tab.snapshot ? { snapshot: tab.snapshot } : {}),
    ...(tab.openerId ? { openerId: tab.openerId } : {}),
  }
}

export function serializeTabs(data: FilesTabsData): string {
  const stored: StoredTabs = {
    v: VERSION,
    tabs: data.tabs.map(storeTab),
    activeId: data.activeId,
    closed: data.closed.map((entry) => ({ tabs: entry.tabs.map(({ tab, index }) => ({ tab: storeTab(tab), index })) })),
  }
  return JSON.stringify(stored)
}

const SNAPSHOT_KINDS = new Set(['folder', 'doc', 'blob', 'chat', 'shortcut'])

function readSnapshot(value: unknown): TabSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.name !== 'string' || typeof candidate.kind !== 'string' || !SNAPSHOT_KINDS.has(candidate.kind)) return null
  const text = (key: string) => typeof candidate[key] === 'string' ? candidate[key] as string : undefined
  return {
    kind: candidate.kind as TabSnapshot['kind'],
    name: candidate.name.slice(0, 1024),
    mimeType: text('mimeType') ?? null,
    ...(text('systemRole') ? { systemRole: text('systemRole') as TabSnapshot['systemRole'] } : {}),
    ...(text('color') ? { color: text('color') as TabSnapshot['color'] } : {}),
    ...(text('icon') ? { icon: text('icon') as TabSnapshot['icon'] } : {}),
  }
}

function readLocation(value: unknown): FilesLocation | null {
  const content = typeof value === 'string' ? parsePanelContent(value) : null
  return content && content.kind !== 'attachment' ? content : null
}

function readTab(value: unknown, seen: Set<string>): FilesTab | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const location = readLocation(candidate.location)
  if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 64 || seen.has(candidate.id) || !location) return null
  seen.add(candidate.id)
  return {
    id: candidate.id,
    location,
    pinned: candidate.pinned === true,
    snapshot: readSnapshot(candidate.snapshot),
    ...(typeof candidate.openerId === 'string' ? { openerId: candidate.openerId } : {}),
  }
}

/** Reads stored tabs, dropping anything malformed; null when nothing usable is stored. */
export function parseTabs(raw: string | null): FilesTabsData | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const stored = parsed as Partial<StoredTabs>
  if (stored.v !== VERSION || !Array.isArray(stored.tabs)) return null
  const seen = new Set<string>()
  const read = stored.tabs.slice(0, MAX_TABS).map((tab) => readTab(tab, seen)).filter((tab): tab is FilesTab => Boolean(tab))
  // Pinned tabs always lead.
  const tabs = [...read.filter((tab) => tab.pinned), ...read.filter((tab) => !tab.pinned)]
  const closed: ClosedTabs[] = (Array.isArray(stored.closed) ? stored.closed : []).slice(-MAX_CLOSED).flatMap((entry) => {
    if (!entry || !Array.isArray(entry.tabs)) return []
    const entryIds = new Set<string>()
    const restored = entry.tabs.flatMap((item) => {
      const tab = item && typeof item.index === 'number' && Number.isInteger(item.index) && item.index >= 0 ? readTab(item.tab, entryIds) : null
      return tab ? [{ tab, index: item.index }] : []
    })
    return restored.length ? [{ tabs: restored }] : []
  })
  // Every tab may have been closed, and what was closed can still be reopened.
  if (!tabs.length && !closed.length) return null
  const activeId = typeof stored.activeId === 'string' && tabs.some((tab) => tab.id === stored.activeId) ? stored.activeId : tabs[0]?.id ?? ''
  return { tabs, activeId, closed }
}

function sessionStore(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

function localStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * The tabs belong to the window, like a browser's: on the web each browser tab keeps its own
 * through reloads and session restore, and a new browser tab starts with one. The desktop app has
 * a single window whose session storage is lost when it closes, so it keeps them across launches.
 */
export function loadTabs(owner: string): FilesTabsData | null {
  const key = tabsStorageKey(owner)
  let session: string | null = null
  try { session = sessionStore()?.getItem(key) ?? null } catch { /* storage is optional */ }
  const fromSession = parseTabs(session)
  if (fromSession || !isDesktopRuntime()) return fromSession
  try { return parseTabs(localStore()?.getItem(key) ?? null) } catch { return null }
}

export function saveTabs(owner: string, data: FilesTabsData): void {
  const key = tabsStorageKey(owner)
  const value = serializeTabs(data)
  try { sessionStore()?.setItem(key, value) } catch { /* storage is optional */ }
  if (isDesktopRuntime()) {
    try { localStore()?.setItem(key, value) } catch { /* storage is optional */ }
  }
}

/** Forgets an account's tabs, which name its files, when it signs out. */
export function clearStoredTabs(owner: string): void {
  const key = tabsStorageKey(owner)
  try { sessionStore()?.removeItem(key) } catch { /* storage is optional */ }
  try { localStore()?.removeItem(key) } catch { /* storage is optional */ }
}
