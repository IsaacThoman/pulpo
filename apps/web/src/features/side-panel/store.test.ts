// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clampPanelWidth, parsePanelContent, serializePanelContent, splitFits, useSidePanel, type PanelContent } from './store'

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'
const c = '2b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5d'

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

  describe('tabs', () => {
    const file = (id: string): PanelContent => ({ kind: 'file', id })
    const state = () => useSidePanel.getState()
    beforeEach(() => useSidePanel.setState({ content: null, tabs: [], lastContent: null }))

    it('opens each item in its own tab after the one in view, and switches to an open one', () => {
      state().open(file(a))
      state().open(file(b))
      state().open({ kind: 'folder', id: null })
      expect(state().tabs).toEqual([file(a), file(b), { kind: 'folder', id: null }])
      state().open(file(a))
      expect(state().content).toEqual(file(a))
      state().open(file(c))
      expect(state().tabs).toEqual([file(a), file(c), file(b), { kind: 'folder', id: null }])
    })

    it('browses in place of the tab in view', () => {
      state().open(file(a))
      state().open({ kind: 'folder', id: null })
      state().show(file(b))
      expect(state().tabs).toEqual([file(a), file(b)])
      expect(state().content).toEqual(file(b))
      // Browsing to something open in another tab switches to it.
      state().show(file(a))
      expect(state().tabs).toEqual([file(a), file(b)])
      expect(state().content).toEqual(file(a))
    })

    it('shows the next tab, or else the previous, when the one in view closes, and closes with the last', () => {
      for (const id of [a, b, c]) state().open(file(id))
      state().open(file(b))
      state().closeTab(file(b))
      expect(state().content).toEqual(file(c))
      state().closeTab(file(c))
      expect(state().content).toEqual(file(a))
      state().open(file(b))
      state().closeTab(file(a))
      expect(state().content).toEqual(file(b))
      state().closeTab(file(b))
      expect(state().content).toBeNull()
      expect(state().tabs).toEqual([])
    })

    it('reopens every tab after closing the panel, but starts over when something else opens', () => {
      state().open(file(a))
      state().open(file(b))
      state().close()
      state().toggle()
      expect(state().tabs).toEqual([file(a), file(b)])
      expect(state().content).toEqual(file(b))
      state().close()
      state().open(file(c))
      expect(state().tabs).toEqual([file(c)])
    })

    it('keeps the tabs for a reload of this browser tab', () => {
      state().open(file(a))
      state().open({ kind: 'folder', id: b })
      expect(JSON.parse(sessionStorage.getItem('pulpo.sidePanel.tabs')!)).toEqual([`file:${a}`, `folder:${b}`])
    })
  })
})
