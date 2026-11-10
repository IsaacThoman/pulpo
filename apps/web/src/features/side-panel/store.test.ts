// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createTab } from '@/features/files/tabs/model'
import { panelTabsStorageKey, savePanelTabs } from '@/features/files/tabs/storage'
import {
  clampPanelWidth,
  ensurePanelTabs,
  forgetPanelTabs,
  panelTabActions,
  parsePanelContent,
  serializePanelContent,
  setPanelTabsEnabled,
  splitFits,
  useSidePanel,
  type PanelContent,
} from './store'
import { openBeside } from './use-panel-actions'

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'
const c = '2b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5d'

const file = (id: string): PanelContent => ({ kind: 'file', id })
const folder = (id: string | null): PanelContent => ({ kind: 'folder', id })
const places = () => useSidePanel.getState().tabs.map((tab) => tab.location)
const shown = () => useSidePanel.getState().content

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  useSidePanel.setState({ content: null, tabs: [], activeId: '', closed: [], owner: null, tabsEnabled: true })
})

describe('side panel state', () => {
  it('round-trips files, folders, and attachments through the URL parameter', () => {
    const contents: PanelContent[] = [
      { kind: 'file', id: a },
      { kind: 'attachment', id: b },
      { kind: 'folder', id: b },
      { kind: 'folder', id: null },
    ]
    for (const content of contents) {
      expect(parsePanelContent(serializePanelContent(content))).toEqual(content)
    }
    expect(serializePanelContent({ kind: 'folder', id: null })).toBe('folder:root')
    expect(parsePanelContent(`FILE:${a.toUpperCase()}`)).toEqual({ kind: 'file', id: a })
  })

  it('rejects anything else, including chats, which only open in the main view', () => {
    expect(parsePanelContent('file:not-an-id')).toBeNull()
    expect(parsePanelContent(`chat:${a}`)).toBeNull()
    expect(parsePanelContent('chat:new')).toBeNull()
    expect(parsePanelContent('folder:')).toBeNull()
    expect(parsePanelContent(null)).toBeNull()
  })

  it('fits the panel beside a usable main view', () => {
    expect(clampPanelWidth(100, 1600)).toBe(320)
    expect(clampPanelWidth(2000, 1600)).toBe(1240)
    expect(clampPanelWidth(600, 1600)).toBe(600)
    expect(clampPanelWidth(600, 800)).toBe(440)
    expect(splitFits(680)).toBe(true)
    expect(splitFits(679)).toBe(false)
  })

  it('reopens the last content after closing', () => {
    const store = useSidePanel.getState()
    store.open({ kind: 'file', id: a })
    store.close()
    expect(useSidePanel.getState().content).toBeNull()
    useSidePanel.getState().toggle()
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: a })
  })
})

describe('side panel tabs', () => {
  it('shows what opens from elsewhere in a tab already showing it, or a new one after the active tab', () => {
    const { open } = useSidePanel.getState()
    open(file(a))
    open(file(b))
    expect(places()).toEqual([file(a), file(b)])
    expect(shown()).toEqual(file(b))

    open(file(a))
    expect(places()).toEqual([file(a), file(b)])
    expect(shown()).toEqual(file(a))

    open(folder(null))
    expect(places()).toEqual([file(a), folder(null), file(b)])
    expect(shown()).toEqual(folder(null))
    expect(useSidePanel.getState().tabs.find((tab) => tab.id === useSidePanel.getState().activeId)?.location).toEqual(folder(null))
  })

  it('shows a hidden panel again when something opens in it, keeping its tabs', () => {
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().close()
    useSidePanel.getState().open(file(b))
    expect(places()).toEqual([file(a), file(b)])
    expect(shown()).toEqual(file(b))
  })

  it('browses in the active tab, and opens one when there is none', () => {
    useSidePanel.getState().navigate(folder(a))
    expect(places()).toEqual([folder(a)])
    useSidePanel.getState().open(file(b))
    useSidePanel.getState().navigate(folder(c))
    expect(places()).toEqual([folder(a), folder(c)])
    expect(shown()).toEqual(folder(c))
  })

  it('keeps its tabs when hidden, and Cmd/Ctrl+\\ brings them back', () => {
    const { open } = useSidePanel.getState()
    open(file(a))
    open(file(b))
    useSidePanel.getState().close()
    expect(shown()).toBeNull()
    expect(places()).toEqual([file(a), file(b)])
    useSidePanel.getState().toggle()
    expect(shown()).toEqual(file(b))
    useSidePanel.getState().toggle()
    expect(shown()).toBeNull()
  })

  it('hides after its last tab closes, and reopens the tabs closed last', () => {
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().open(file(b))
    const [first, second] = useSidePanel.getState().tabs
    panelTabActions.close(second!.id)
    expect(shown()).toEqual(file(a))
    panelTabActions.close(first!.id)
    expect(shown()).toBeNull()
    expect(places()).toEqual([])
    expect(useSidePanel.getState().closed).toHaveLength(2)

    useSidePanel.getState().toggle()
    expect(places()).toEqual([file(a)])
    expect(shown()).toEqual(file(a))
    panelTabActions.reopen()
    expect(places()).toEqual([file(a), file(b)])
  })

  it('opens a new tab of My files from +, and items behind the active tab', () => {
    useSidePanel.getState().open(file(a))
    panelTabActions.openInBackground(file(b), { kind: 'doc', name: 'Plan.md', mimeType: null })
    expect(places()).toEqual([file(a), file(b)])
    expect(shown()).toEqual(file(a))
    expect(useSidePanel.getState().tabs[1]!.snapshot?.name).toBe('Plan.md')
    panelTabActions.newTab()
    expect(places()).toEqual([file(a), file(b), folder(null)])
    expect(shown()).toEqual(folder(null))
  })

  it('closes every tab of a document the main view opens, and hides once none are left', () => {
    const { open } = useSidePanel.getState()
    open(file(a))
    open(file(b))
    open(file(a))
    // Two tabs at the same place, one of them in the background.
    panelTabActions.duplicate(useSidePanel.getState().activeId)
    panelTabActions.select(useSidePanel.getState().tabs.at(-1)!.id)
    expect(places()).toEqual([file(a), file(a), file(b)])
    panelTabActions.remove(file(a))
    expect(places()).toEqual([file(b)])
    expect(shown()).toEqual(file(b))
    panelTabActions.remove(file(b))
    expect(shown()).toBeNull()
  })

  it('closes the tab showing a view from the view, preferring the active one', () => {
    useSidePanel.getState().open(folder(null))
    useSidePanel.getState().open(file(a))
    panelTabActions.newTab()
    const before = useSidePanel.getState().tabs.map((tab) => tab.id)
    panelTabActions.closeShowing(folder(null))
    expect(useSidePanel.getState().tabs.map((tab) => tab.id)).toEqual([before[0], before[1]])
    expect(shown()).toEqual(file(a))
  })

  it('holds one thing at a time without Files, as before it had tabs', () => {
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().open(file(b))
    setPanelTabsEnabled(false)
    expect(places()).toEqual([file(b)])
    useSidePanel.getState().open(file(c))
    expect(places()).toEqual([file(c)])
    panelTabActions.closeShowing(file(c))
    expect(shown()).toBeNull()
    useSidePanel.getState().toggle()
    expect(shown()).toEqual(file(c))
    setPanelTabsEnabled(true)
  })

  it('reopens only one thing without Files, even tabs closed together with it on', () => {
    useSidePanel.getState().open(file(a))
    panelTabActions.duplicate(useSidePanel.getState().activeId)
    // Both copies close together, as when the main view opens the file.
    panelTabActions.remove(file(a))
    expect(useSidePanel.getState().closed.at(-1)?.tabs).toHaveLength(2)
    setPanelTabsEnabled(false)
    useSidePanel.getState().toggle()
    expect(places()).toEqual([file(a)])
    expect(shown()).toEqual(file(a))
    setPanelTabsEnabled(true)
  })
})

describe('stored side panel tabs', () => {
  it('saves tab changes per account, and not showing or hiding the panel', () => {
    ensurePanelTabs('user')
    useSidePanel.getState().open(file(a))
    const stored = sessionStorage.getItem(panelTabsStorageKey('user'))
    expect(stored).toContain(`file:${a}`)
    // Main view tabs are kept apart.
    expect(sessionStorage.getItem('pulpo.files.tabs:user')).toBeNull()

    sessionStorage.removeItem(panelTabsStorageKey('user'))
    useSidePanel.getState().close()
    useSidePanel.getState().toggle()
    expect(sessionStorage.getItem(panelTabsStorageKey('user'))).toBeNull()
  })

  it('loads an account’s tabs hidden, and adds what the panel already shows', () => {
    const first = createTab(file(a), { id: 'first' })
    const second = createTab({ kind: 'attachment', id: b }, { id: 'second', snapshot: { kind: 'blob', name: 'photo.png', mimeType: 'image/png' } })
    savePanelTabs('user', { tabs: [first, second], activeId: 'first', closed: [] })

    ensurePanelTabs('user')
    expect(places()).toEqual([file(a), { kind: 'attachment', id: b }])
    expect(shown()).toBeNull()

    useSidePanel.setState({ owner: null, tabs: [], activeId: '', closed: [], content: { kind: 'attachment', id: b } })
    ensurePanelTabs('user')
    expect(places()).toEqual([file(a), { kind: 'attachment', id: b }])
    expect(useSidePanel.getState().activeId).toBe('second')
    expect(shown()).toEqual({ kind: 'attachment', id: b })

    // A new place opens after the tab that was active when the tabs were saved.
    useSidePanel.setState({ owner: null, tabs: [], activeId: '', closed: [], content: folder(c) })
    ensurePanelTabs('user')
    expect(places()).toEqual([file(a), { kind: 'attachment', id: b }, folder(c)])
    expect(shown()).toEqual(folder(c))
  })

  it('keeps closed tabs with no open ones, and forgets them on sign-out', () => {
    ensurePanelTabs('user')
    useSidePanel.getState().open(file(a))
    panelTabActions.close(useSidePanel.getState().activeId)
    useSidePanel.setState({ owner: null, tabs: [], activeId: '', closed: [] })
    ensurePanelTabs('user')
    expect(places()).toEqual([])
    expect(useSidePanel.getState().closed).toHaveLength(1)

    forgetPanelTabs('user')
    expect(sessionStorage.getItem(panelTabsStorageKey('user'))).toBeNull()
    expect(useSidePanel.getState()).toMatchObject({ owner: null, tabs: [], closed: [], content: null })
  })

  it('does not carry one account’s panel over to another', () => {
    ensurePanelTabs('user')
    useSidePanel.getState().open(file(a))
    ensurePanelTabs('other')
    expect(places()).toEqual([])
    expect(shown()).toBeNull()
  })
})

describe('opening beside the main view', () => {
  it('leaves the main view’s own file alone, keeping a hidden panel hidden', () => {
    useSidePanel.getState().open(file(b))
    useSidePanel.getState().close()
    window.history.replaceState(null, '', `/files/d/${a}`)
    const go = (path: string) => { throw new Error(`navigated to ${path}`) }
    openBeside(file(a), go)
    expect(shown()).toBeNull()
    expect(places()).toEqual([file(b)])
    expect(useSidePanel.getState().closed).toHaveLength(0)
    openBeside(folder(c), go)
    expect(shown()).toEqual(folder(c))
    window.history.replaceState(null, '', '/')
  })

  it('reopens the tabs closed before the main view’s own document, which stays closed', () => {
    useSidePanel.getState().open(file(a))
    useSidePanel.getState().open(file(b))
    panelTabActions.close(useSidePanel.getState().tabs[0]!.id)
    window.history.replaceState(null, '', `/files/d/${b}`)
    panelTabActions.remove(file(b))
    expect(shown()).toBeNull()
    useSidePanel.getState().toggle()
    expect(shown()).toEqual(file(a))
    expect(places()).toEqual([file(a)])
    useSidePanel.getState().close()
    window.history.replaceState(null, '', '/')
  })
})
