import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { create } from 'zustand'
import { useAuth } from '@/stores/auth'
import { activeTab, addTab, moveTab, navigateContent, NO_TABS, openContent, readTabs, removeContent, removeTabs, sameContent, writeTabs, type PaneTab, type PaneTabs } from './pane-tabs'
import { useSidePanel, type PanelContent } from './store'
import { mainViewContent, panelContentPath } from './use-panel-actions'

const STORAGE_KEY = 'pulpo.mainView.tabs'

interface MainTabsState extends PaneTabs {
  /** Whose tabs these are; another account on this device starts with its own. */
  userId: string | null
}

/**
 * The main view's tabs: Files folders and files, and chat attachments. Only the active tab is
 * shown, at its own URL; the others remember where they were. Chats are not tabs: while one is in
 * the main view, the tabs wait for the user to come back.
 */
export const useMainTabs = create<MainTabsState>()(() => ({ ...NO_TABS, userId: null }))

function update(userId: string, change: (state: PaneTabs) => PaneTabs): PaneTabs {
  const current = useMainTabs.getState()
  const base = current.userId === userId ? current : readTabs(STORAGE_KEY, userId)
  const next = change(base)
  if (next !== current) {
    useMainTabs.setState({ userId, tabs: next.tabs, activeId: next.activeId }, true)
    writeTabs(STORAGE_KEY, userId, next)
  }
  return next
}

export const mainTabs = {
  /** Loads the account's tabs kept on this device, before any of them is shown. */
  load: (userId: string | undefined) => { if (userId) update(userId, (state) => state) },
  open: (userId: string, content: PanelContent) => update(userId, (state) => openContent(state, content)),
  add: (userId: string, content: PanelContent, options?: { background?: boolean; after?: string }) => update(userId, (state) => addTab(state, content, options)),
  activate: (userId: string, id: string) => update(userId, (state) => state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id } : state),
  close: (userId: string, ids: Iterable<string>) => update(userId, (state) => removeTabs(state, new Set(ids))),
  move: (userId: string, id: string, index: number) => update(userId, (state) => moveTab(state, id, index)),
  removeContent: (userId: string, content: PanelContent) => update(userId, (state) => removeContent(state, content)),
}

/**
 * Shows `content` in the main view, in the tab already showing it or a new one, as when it comes
 * from the side panel. Without an account the main view simply goes there.
 */
export function showInMainView(content: PanelContent, go: (pathname: string) => void): void {
  const userId = useAuth.getState().user?.id
  if (userId) mainTabs.open(userId, content)
  go(panelContentPath(content))
}

/** Moves a side panel tab to the main view, where it opens in its own tab. */
export function movePanelTabToMain(tab: PaneTab, go: (pathname: string) => void): void {
  useSidePanel.getState().closeTabs([tab.id])
  showInMainView(tab.content, go)
}

/** How the main view came to show something: see `followMainView`. */
export type MainViewArrival = 'history' | 'browse' | 'open'

/**
 * Keeps the tabs on what the main view shows. Browsing from one tab's view to another place moves
 * that tab. Arriving from elsewhere (a chat, the sidebar) shows the tab already there, else a new
 * one. Back and forward return to a tab already showing the place, else move the active tab.
 */
export function followMainView(state: PaneTabs, content: PanelContent, arrival: MainViewArrival): PaneTabs {
  const active = activeTab(state)
  if (active && sameContent(active.content, content)) return state
  if (arrival === 'open') return openContent(state, content)
  if (arrival === 'history') {
    const existing = state.tabs.find((tab) => sameContent(tab.content, content))
    if (existing) return { ...state, activeId: existing.id }
  }
  return navigateContent(state, content)
}

/** Follows the main view's location with the tabs; mounted once, by the app layout. */
export function useMainTabsFollow(): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const userId = useAuth((state) => state.user?.id)
  const previous = useRef<string | null>(null)
  useEffect(() => {
    const from = previous.current
    previous.current = location.pathname
    const content = mainViewContent(location.pathname)
    if (!userId || !content) return
    const arrival: MainViewArrival = navigationType === 'POP' ? 'history' : from && mainViewContent(from) ? 'browse' : 'open'
    update(userId, (state) => followMainView(state, content, arrival))
    // A location change is what moves a tab; the rest is read with it.
    // oxlint-disable-next-line react/exhaustive-deps -- navigationType and pathname belong to the same location
  }, [location.key, userId])
}

/**
 * Where the sidebar's Files button goes: from elsewhere, back to the active tab while it shows a
 * Files folder or file; within the tabs' views, to My files as always.
 */
export function filesHomePath(pathname: string): string {
  mainTabs.load(useAuth.getState().user?.id)
  const active = activeTab(useMainTabs.getState())
  if (mainViewContent(pathname) || !active || active.content.kind === 'attachment') return '/files'
  return panelContentPath(active.content)
}
