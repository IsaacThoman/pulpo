import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { create } from 'zustand'
import { useAuth } from '@/stores/auth'
import { parsePanelContent, serializePanelContent, type PanelContent } from '@/features/side-panel/store'
import { mainViewContent, panelContentPath } from '@/features/side-panel/use-panel-actions'

const STORAGE_KEY = 'pulpo.files.tabs'

/** What a Files tab shows: a folder (null is My files; trash references as in features/trash/folder) or a file. */
export type FilesTabContent = Extract<PanelContent, { kind: 'file' | 'folder' }>

export interface FilesTab {
  id: string
  content: FilesTabContent
}

export interface FilesTabsState {
  /** Whose tabs these are; another account on this device starts with its own. */
  userId: string | null
  tabs: FilesTab[]
  activeId: string | null
}

const EMPTY: FilesTabsState = { userId: null, tabs: [], activeId: null }

const key = (content: FilesTabContent) => serializePanelContent(content)!
export const sameTabContent = (left: FilesTabContent, right: FilesTabContent) => key(left) === key(right)

function newTab(content: FilesTabContent): FilesTab {
  return { id: crypto.randomUUID(), content }
}

export function activeTab(state: Pick<FilesTabsState, 'tabs' | 'activeId'>): FilesTab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null
}

/**
 * The main view showing `content` moves the active tab there, as browsing does in a file manager's
 * tab. Back and forward (`traversal`) instead return to a tab already showing it, so walking back
 * through a tab switch switches back rather than copying the other tab into this one.
 */
export function followContent(state: FilesTabsState, content: FilesTabContent, traversal: boolean): FilesTabsState {
  const active = activeTab(state)
  if (active && sameTabContent(active.content, content)) return state
  if (!active) {
    const tab = newTab(content)
    return { ...state, tabs: [...state.tabs, tab], activeId: tab.id }
  }
  const existing = traversal ? state.tabs.find((tab) => sameTabContent(tab.content, content)) : undefined
  if (existing) return { ...state, activeId: existing.id }
  return { ...state, tabs: state.tabs.map((tab) => tab.id === active.id ? { ...tab, content } : tab) }
}

/**
 * Adds a tab right after the active one (or `after`), as browsers do, and makes it active unless
 * `background`.
 */
export function addTab(state: FilesTabsState, content: FilesTabContent, options: { background?: boolean; after?: string } = {}): FilesTabsState {
  const tab = newTab(content)
  const background = options.background ?? false
  const at = state.tabs.findIndex((candidate) => candidate.id === (options.after ?? state.activeId))
  const tabs = [...state.tabs]
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
  return { ...state, tabs, activeId: background && state.activeId ? state.activeId : tab.id }
}

/** Closes tabs; when the active one goes, the next tab to its right (else its left) takes over. */
export function removeTabs(state: FilesTabsState, ids: ReadonlySet<string>): FilesTabsState {
  const tabs = state.tabs.filter((tab) => !ids.has(tab.id))
  // The view always has a tab: the last one stays.
  if (!tabs.length) return state
  if (!state.activeId || !ids.has(state.activeId)) return { ...state, tabs }
  const at = state.tabs.findIndex((tab) => tab.id === state.activeId)
  const next = state.tabs.slice(at + 1).find((tab) => !ids.has(tab.id)) ?? state.tabs.slice(0, at).reverse().find((tab) => !ids.has(tab.id))
  return { ...state, tabs, activeId: next!.id }
}

/** Moves a tab so it sits at `index` among the others. */
export function moveTab(state: FilesTabsState, id: string, index: number): FilesTabsState {
  const tab = state.tabs.find((candidate) => candidate.id === id)
  if (!tab) return state
  const rest = state.tabs.filter((candidate) => candidate.id !== id)
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, tab)
  return { ...state, tabs: rest }
}

function read(userId: string): FilesTabsState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { userId?: unknown; tabs?: unknown; active?: unknown } | null
    if (!saved || saved.userId !== userId || !Array.isArray(saved.tabs)) return { ...EMPTY, userId }
    const tabs = saved.tabs
      .map((value) => parsePanelContent(typeof value === 'string' ? value : null))
      .filter((content): content is FilesTabContent => content?.kind === 'file' || content?.kind === 'folder')
      .map(newTab)
    const active = typeof saved.active === 'number' ? tabs[saved.active] ?? tabs[0] : tabs[0]
    return { userId, tabs, activeId: active?.id ?? null }
  } catch {
    return { ...EMPTY, userId }
  }
}

function write(state: FilesTabsState): void {
  if (!state.userId) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      userId: state.userId,
      tabs: state.tabs.map((tab) => key(tab.content)),
      active: state.tabs.findIndex((tab) => tab.id === state.activeId),
    }))
  } catch { /* the tabs are optional */ }
}

/**
 * The main view's Files tabs. They belong to the window and are kept on this device, so a reload
 * reopens them. Only the active tab is rendered; the others remember where they were.
 */
export const useFilesTabs = create<FilesTabsState>()(() => EMPTY)

function update(userId: string, change: (state: FilesTabsState) => FilesTabsState): FilesTabsState {
  const current = useFilesTabs.getState()
  const next = change(current.userId === userId ? current : read(userId))
  if (next !== current) {
    useFilesTabs.setState(next, true)
    write(next)
  }
  return next
}

/** Loads this account's saved tabs if nothing has yet, so they are known before any Files view opens. */
export function loadFilesTabs(userId: string | undefined): void {
  if (userId && useFilesTabs.getState().userId !== userId) useFilesTabs.setState(read(userId), true)
}

export const filesTabs = {
  follow: (userId: string, content: FilesTabContent, traversal: boolean) => update(userId, (state) => followContent(state, content, traversal)),
  add: (userId: string, content: FilesTabContent, options?: { background?: boolean; after?: string }) => update(userId, (state) => addTab(state, content, options)),
  activate: (userId: string, id: string) => update(userId, (state) => state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id } : state),
  close: (userId: string, ids: Iterable<string>) => update(userId, (state) => removeTabs(state, new Set(ids))),
  move: (userId: string, id: string, index: number) => update(userId, (state) => moveTab(state, id, index)),
}

/** Keeps the active tab on what the main view shows (`content`), as the user browses. */
export function useFollowFilesTab(userId: string | undefined, content: FilesTabContent | null): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const serialized = content && key(content)
  useEffect(() => {
    // An address that names nothing valid shows an error, not a tab. A view on its way out (the
    // location already shows something else) moves nothing.
    const parsed = parsePanelContent(serialized)
    if (!userId || (parsed?.kind !== 'file' && parsed?.kind !== 'folder')) return
    if (serializePanelContent(mainViewContent(location.pathname)) !== serializePanelContent(parsed)) return
    filesTabs.follow(userId, parsed, navigationType === 'POP')
    // A location change is what moves a tab; the content is read from it.
    // oxlint-disable-next-line react/exhaustive-deps -- navigationType belongs to the same location
  }, [userId, serialized, location.key])
}

/**
 * Where the sidebar's Files button goes: from elsewhere, back to the active tab while several are
 * open, so they are found as they were left; within Files, or with one tab, to My files as always.
 */
export function filesHomePath(pathname: string): string {
  loadFilesTabs(useAuth.getState().user?.id)
  const state = useFilesTabs.getState()
  const active = activeTab(state)
  if (mainViewContent(pathname) || !active || state.tabs.length < 2) return '/files'
  return panelContentPath(active.content)
}
