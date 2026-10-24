import type { PanelContent } from './store'

/*
 * Tabs for the two views, the main view and the side panel, which work alike: things opened
 * into a view from elsewhere get a tab of their own (or the tab already showing them), browsing
 * inside a tab stays in that tab, and closing the active tab shows the one to its right.
 */

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

export interface PaneTab {
  id: string
  content: PanelContent
}

export interface PaneTabs {
  tabs: PaneTab[]
  activeId: string | null
}

export const NO_TABS: PaneTabs = { tabs: [], activeId: null }

const contentKey = (content: PanelContent) => serializePanelContent(content)!

export const sameContent = (left: PanelContent, right: PanelContent) => contentKey(left) === contentKey(right)

export function activeTab(state: PaneTabs): PaneTab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null
}

function newTab(content: PanelContent): PaneTab {
  return { id: crypto.randomUUID(), content }
}

/**
 * Adds a tab after the active one (or `after`), as browsers do, and makes it active unless
 * `background`.
 */
export function addTab(state: PaneTabs, content: PanelContent, options: { background?: boolean; after?: string } = {}): PaneTabs {
  const tab = newTab(content)
  const at = state.tabs.findIndex((candidate) => candidate.id === (options.after ?? state.activeId))
  const tabs = [...state.tabs]
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
  return { tabs, activeId: options.background && state.activeId ? state.activeId : tab.id }
}

/** Something opened into the view from elsewhere: the tab already showing it, else a new tab. */
export function openContent(state: PaneTabs, content: PanelContent): PaneTabs {
  const existing = state.tabs.find((tab) => sameContent(tab.content, content))
  if (existing) return existing.id === state.activeId ? state : { ...state, activeId: existing.id }
  return addTab(state, content)
}

/** Browsing inside the active tab: it moves there. Without a tab, one opens. */
export function navigateContent(state: PaneTabs, content: PanelContent): PaneTabs {
  const active = activeTab(state)
  if (!active) return addTab(state, content)
  if (sameContent(active.content, content)) return state
  return { ...state, tabs: state.tabs.map((tab) => tab.id === active.id ? { ...tab, content } : tab) }
}

/** Closes tabs; when the active one goes, the next tab to its right (else its left) takes over. */
export function removeTabs(state: PaneTabs, ids: ReadonlySet<string>): PaneTabs {
  const tabs = state.tabs.filter((tab) => !ids.has(tab.id))
  if (tabs.length === state.tabs.length) return state
  if (!state.activeId || !ids.has(state.activeId)) return { ...state, tabs }
  const at = state.tabs.findIndex((tab) => tab.id === state.activeId)
  const next = state.tabs.slice(at + 1).find((tab) => !ids.has(tab.id)) ?? state.tabs.slice(0, at).reverse().find((tab) => !ids.has(tab.id))
  return { tabs, activeId: next?.id ?? null }
}

/** Closes every tab showing `content`. */
export function removeContent(state: PaneTabs, content: PanelContent): PaneTabs {
  return removeTabs(state, new Set(state.tabs.filter((tab) => sameContent(tab.content, content)).map((tab) => tab.id)))
}

/** Moves a tab so it sits at `index` among the others. */
export function moveTab(state: PaneTabs, id: string, index: number): PaneTabs {
  const tab = state.tabs.find((candidate) => candidate.id === id)
  if (!tab) return state
  const rest = state.tabs.filter((candidate) => candidate.id !== id)
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, tab)
  return { ...state, tabs: rest }
}

/** A view's tabs as kept on this device, for one account. */
export function readTabs(storageKey: string, userId: string): PaneTabs {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { userId?: unknown; tabs?: unknown; active?: unknown } | null
    if (!saved || saved.userId !== userId || !Array.isArray(saved.tabs)) return NO_TABS
    const tabs = saved.tabs.map((value) => parsePanelContent(typeof value === 'string' ? value : null)).filter((content): content is PanelContent => content !== null).map(newTab)
    const active = typeof saved.active === 'number' ? tabs[saved.active] ?? tabs[0] : tabs[0]
    return { tabs, activeId: active?.id ?? null }
  } catch {
    return NO_TABS
  }
}

export function writeTabs(storageKey: string, userId: string, state: PaneTabs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      userId,
      tabs: state.tabs.map((tab) => contentKey(tab.content)),
      active: state.tabs.findIndex((tab) => tab.id === state.activeId),
    }))
  } catch { /* the tabs are optional */ }
}
