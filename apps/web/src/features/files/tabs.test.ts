// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import { activeTab, addTab, filesHomePath, filesTabs, followContent, moveTab, removeTabs, useFilesTabs, type FilesTabContent, type FilesTabsState } from './tabs'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'
const c = '2b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5d'
const folder = (id: string | null): FilesTabContent => ({ kind: 'folder', id })
const file = (id: string): FilesTabContent => ({ kind: 'file', id })

function tabs(...contents: FilesTabContent[]): FilesTabsState {
  return { userId: 'user', tabs: contents.map((content, index) => ({ id: `t${index}`, content })), activeId: 't0' }
}
const shown = (state: FilesTabsState) => state.tabs.map((tab) => tab.content)

beforeEach(() => {
  localStorage.clear()
  useFilesTabs.setState({ userId: null, tabs: [], activeId: null }, true)
})

describe('Files tabs', () => {
  it('starts with one tab where the view is', () => {
    const state = followContent({ userId: 'user', tabs: [], activeId: null }, folder(null), false)
    expect(shown(state)).toEqual([folder(null)])
    expect(activeTab(state)?.content).toEqual(folder(null))
  })

  it('moves the active tab as the user browses, even to where another tab is', () => {
    const state = followContent(tabs(folder(a), folder(b)), folder(b), false)
    expect(shown(state)).toEqual([folder(b), folder(b)])
    expect(state.activeId).toBe('t0')
  })

  it('switches back to a tab already showing a place reached with back or forward', () => {
    const state = followContent(tabs(folder(a), file(b)), file(b), true)
    expect(shown(state)).toEqual([folder(a), file(b)])
    expect(state.activeId).toBe('t1')
    // Somewhere no tab is: the active tab goes there.
    const elsewhere = followContent(state, folder(c), true)
    expect(shown(elsewhere)).toEqual([folder(a), folder(c)])
  })

  it('adds tabs after the active one, in the background when asked', () => {
    const start = { ...tabs(folder(a), folder(b)), activeId: 't0' }
    const foreground = addTab(start, file(c))
    expect(shown(foreground)).toEqual([folder(a), file(c), folder(b)])
    expect(activeTab(foreground)?.content).toEqual(file(c))
    const background = addTab(start, file(c), { background: true })
    expect(background.activeId).toBe('t0')
    expect(shown(addTab(start, file(c), { after: 't1' }))).toEqual([folder(a), folder(b), file(c)])
  })

  it('activates the tab to the right of a closed active tab, else the one to its left, and keeps the last', () => {
    const state = { ...tabs(folder(a), folder(b), folder(c)), activeId: 't1' }
    expect(removeTabs(state, new Set(['t1'])).activeId).toBe('t2')
    expect(removeTabs({ ...state, activeId: 't2' }, new Set(['t2'])).activeId).toBe('t1')
    expect(removeTabs(state, new Set(['t0'])).activeId).toBe('t1')
    expect(removeTabs(state, new Set(['t0', 't1', 't2']))).toBe(state)
  })

  it('reorders tabs', () => {
    expect(shown(moveTab(tabs(folder(a), folder(b), folder(c)), 't0', 2))).toEqual([folder(b), folder(c), folder(a)])
    expect(shown(moveTab(tabs(folder(a), folder(b), folder(c)), 't2', 0))).toEqual([folder(c), folder(a), folder(b)])
  })

  it('keeps tabs on this device for the same account only', () => {
    filesTabs.follow('user', folder(a), false)
    filesTabs.add('user', file(b))
    useFilesTabs.setState({ userId: null, tabs: [], activeId: null }, true)
    // A reload restores both, with the file still active.
    filesTabs.follow('user', file(b), true)
    expect(shown(useFilesTabs.getState())).toEqual([folder(a), file(b)])
    expect(activeTab(useFilesTabs.getState())?.content).toEqual(file(b))
    // Another account starts over.
    filesTabs.follow('other', folder(null), true)
    expect(shown(useFilesTabs.getState())).toEqual([folder(null)])
  })

  it('returns the sidebar Files button to the active tab from elsewhere while several are open', () => {
    filesTabs.follow('user', folder(a), false)
    expect(filesHomePath('/c/chat')).toBe('/files')
    filesTabs.add('user', file(b))
    expect(filesHomePath('/c/chat')).toBe(`/files/d/${b}`)
    expect(filesHomePath(`/files/d/${b}`)).toBe('/files')
    // After a reload on a chat, before any Files view has loaded the tabs.
    useFilesTabs.setState({ userId: null, tabs: [], activeId: null }, true)
    useAuth.setState({ user: { id: 'user' } } as never)
    expect(filesHomePath('/c/chat')).toBe(`/files/d/${b}`)
  })
})
