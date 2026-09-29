import { describe, expect, it } from 'vitest'
import { clampPanelWidth, parsePanelContent, serializePanelContent, useSidePanel, type PanelContent } from './store'

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'

describe('side panel state', () => {
  it('round-trips files and folders through the URL parameter', () => {
    const contents: PanelContent[] = [
      { kind: 'file', id: a },
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

  it('keeps the panel between its minimum and 70% of the window', () => {
    expect(clampPanelWidth(100, 1600)).toBe(360)
    expect(clampPanelWidth(2000, 1600)).toBe(1120)
    expect(clampPanelWidth(600, 1600)).toBe(600)
    expect(clampPanelWidth(600, 400)).toBe(360)
  })

  it('reopens the last content and forgets maximize when closed', () => {
    const store = useSidePanel.getState()
    store.open({ kind: 'file', id: a })
    store.setMaximized(true)
    expect(useSidePanel.getState().maximized).toBe(true)
    store.close()
    expect(useSidePanel.getState()).toMatchObject({ content: null, maximized: false })
    useSidePanel.getState().toggle()
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: a })
  })
})
