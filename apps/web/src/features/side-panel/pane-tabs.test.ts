// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import { filesHomePath, followMainView, mainTabs, useMainTabs } from './main-tabs'
import { activeTab, addTab, moveTab, navigateContent, openContent, removeTabs, type PaneTabs } from './pane-tabs'
import { useSidePanel, type PanelContent } from './store'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'
const c = '2b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5d'
const folder = (id: string | null): PanelContent => ({ kind: 'folder', id })
const file = (id: string): PanelContent => ({ kind: 'file', id })

function tabs(...contents: PanelContent[]): PaneTabs {
  return { tabs: contents.map((content, index) => ({ id: `t${index}`, content })), activeId: 't0' }
}
const shown = (state: PaneTabs) => state.tabs.map((tab) => tab.content)
const resetPanel = () => useSidePanel.setState({ tabs: [], activeId: null, content: null, hidden: false, closed: { tabs: [], activeId: null }, userId: null })

beforeEach(() => {
  localStorage.clear()
  resetPanel()
  useMainTabs.setState({ userId: null, tabs: [], activeId: null }, true)
})

describe('view tabs', () => {
  it('shows what is opened from elsewhere in the tab already showing it, else a new tab after the active one', () => {
    const start = tabs(folder(a), file(b))
    const existing = openContent(start, file(b))
    expect(shown(existing)).toEqual([folder(a), file(b)])
    expect(existing.activeId).toBe('t1')
    const added = openContent(start, file(c))
    expect(shown(added)).toEqual([folder(a), file(c), file(b)])
    expect(activeTab(added)?.content).toEqual(file(c))
  })

  it('moves the active tab when browsing inside it', () => {
    expect(shown(navigateContent(tabs(folder(a), file(b)), folder(c)))).toEqual([folder(c), file(b)])
    expect(shown(navigateContent({ tabs: [], activeId: null }, folder(c)))).toEqual([folder(c)])
  })

  it('adds tabs in the background or after a given tab', () => {
    const start = tabs(folder(a), folder(b))
    expect(addTab(start, file(c), { background: true }).activeId).toBe('t0')
    expect(shown(addTab(start, file(c), { after: 't1' }))).toEqual([folder(a), folder(b), file(c)])
  })

  it('shows the tab to the right of a closed active tab, else the one to its left', () => {
    const state = { ...tabs(folder(a), folder(b), folder(c)), activeId: 't1' }
    expect(removeTabs(state, new Set(['t1'])).activeId).toBe('t2')
    expect(removeTabs({ ...state, activeId: 't2' }, new Set(['t2'])).activeId).toBe('t1')
    expect(removeTabs(state, new Set(['t0'])).activeId).toBe('t1')
    expect(removeTabs(state, new Set(['t0', 't1', 't2']))).toEqual({ tabs: [], activeId: null })
  })

  it('reorders tabs', () => {
    expect(shown(moveTab(tabs(folder(a), folder(b), folder(c)), 't0', 2))).toEqual([folder(b), folder(c), folder(a)])
  })
})

describe('side panel tabs', () => {
  it('collects what is opened to the side, and browses inside the active tab', () => {
    const panel = useSidePanel.getState()
    panel.open(file(a))
    panel.open(folder(b))
    panel.open(file(a))
    expect(shown(useSidePanel.getState())).toEqual([file(a), folder(b)])
    expect(useSidePanel.getState().content).toEqual(file(a))
    useSidePanel.getState().navigate(file(c))
    expect(shown(useSidePanel.getState())).toEqual([file(c), folder(b)])
  })

  it('closes with its last tab, and brings the tabs back with the toggle', () => {
    const panel = useSidePanel.getState()
    panel.open(file(a))
    panel.open(file(b))
    useSidePanel.getState().closeTabs([useSidePanel.getState().tabs[0]!.id])
    expect(useSidePanel.getState().content).toEqual(file(b))
    useSidePanel.getState().closeTabs([useSidePanel.getState().tabs[0]!.id])
    expect(useSidePanel.getState().content).toBeNull()
    useSidePanel.getState().toggle()
    expect(useSidePanel.getState().content).toEqual(file(b))
  })

  it('hides and shows with its tabs, and closing drops them until the toggle reopens them', () => {
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().open(file(b))
    useSidePanel.getState().toggle()
    expect(useSidePanel.getState().content).toBeNull()
    expect(useSidePanel.getState().tabs).toHaveLength(2)
    // Opening something shows it again, tabs and all.
    useSidePanel.getState().open(folder(c))
    expect(shown(useSidePanel.getState())).toEqual([file(a), file(b), folder(c)])
    useSidePanel.getState().close()
    expect(useSidePanel.getState().tabs).toEqual([])
    useSidePanel.getState().open(file(a))
    expect(shown(useSidePanel.getState())).toEqual([file(a)])
  })

  it('lets the main view take a tab’s content', () => {
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().open(file(b))
    useSidePanel.getState().removeContent(file(b))
    expect(shown(useSidePanel.getState())).toEqual([file(a)])
    expect(useSidePanel.getState().content).toEqual(file(a))
  })

  it('reopens the tabs kept on this device for the account when a link names one of them', () => {
    useSidePanel.getState().restore('user', null)
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().open(file(b))
    resetPanel()
    useSidePanel.getState().restore('user', file(a))
    expect(shown(useSidePanel.getState())).toEqual([file(a), file(b)])
    expect(useSidePanel.getState().content).toEqual(file(a))
    resetPanel()
    // Another place starts on its own, the kept tabs ready for the toggle.
    useSidePanel.getState().restore('user', folder(c))
    expect(shown(useSidePanel.getState())).toEqual([folder(c)])
    resetPanel()
    useSidePanel.getState().restore('other', file(a))
    expect(shown(useSidePanel.getState())).toEqual([file(a)])
  })
})

describe('main view tabs', () => {
  it('follow browsing in the active tab, open places reached from elsewhere in tabs, and walk history between tabs', () => {
    const start = tabs(folder(a), file(b))
    expect(shown(followMainView(start, folder(c), 'browse'))).toEqual([folder(c), file(b)])
    const opened = followMainView(start, folder(c), 'open')
    expect(shown(opened)).toEqual([folder(a), folder(c), file(b)])
    expect(followMainView(start, file(b), 'open').activeId).toBe('t1')
    expect(followMainView(start, file(b), 'history').activeId).toBe('t1')
    expect(shown(followMainView(start, folder(c), 'history'))).toEqual([folder(c), file(b)])
  })

  it('keeps tabs on this device for the same account only', () => {
    mainTabs.open('user', folder(a))
    mainTabs.open('user', file(b))
    useMainTabs.setState({ userId: null, tabs: [], activeId: null }, true)
    mainTabs.load('user')
    expect(shown(useMainTabs.getState())).toEqual([folder(a), file(b)])
    mainTabs.load('other')
    expect(shown(useMainTabs.getState())).toEqual([])
  })

  it('returns the sidebar Files button to the active tab from elsewhere, even after a reload', () => {
    useAuth.setState({ user: { id: 'user' } } as never)
    expect(filesHomePath('/c/chat')).toBe('/files')
    mainTabs.open('user', file(b))
    useMainTabs.setState({ userId: null, tabs: [], activeId: null }, true)
    expect(filesHomePath('/c/chat')).toBe(`/files/d/${b}`)
    expect(filesHomePath(`/files/d/${b}`)).toBe('/files')
  })
})
