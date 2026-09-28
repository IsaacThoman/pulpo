import { describe, expect, it } from 'vitest'
import { clampPanelWidth, parsePanelContent, serializePanelContent, useSidePanel, type PanelContent } from './store'

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'

describe('side panel state', () => {
  it('round-trips files, chats, and scoped new chats through the URL parameter', () => {
    const contents: PanelContent[] = [
      { kind: 'file', id: a },
      { kind: 'chat', id: b },
      { kind: 'chat', id: null, scopeIds: [] },
      { kind: 'chat', id: null, scopeIds: [a, b] },
      { kind: 'chat', id: null, scopeIds: ['root'] },
    ]
    for (const content of contents) {
      expect(parsePanelContent(serializePanelContent(content))).toEqual(content)
    }
  })

  it('rejects anything else', () => {
    expect(parsePanelContent('file:not-an-id')).toBeNull()
    expect(parsePanelContent(`folder:${a}`)).toBeNull()
    expect(parsePanelContent('chat:new:nope')).toBeNull()
    expect(parsePanelContent(null)).toBeNull()
  })

  it('lets the whole tree replace the folders it contains', () => {
    expect(parsePanelContent(`chat:new:${a},root`)).toEqual({ kind: 'chat', id: null, scopeIds: ['root'] })
    expect(parsePanelContent(`chat:new:${a},${a.toUpperCase()}`)).toEqual({ kind: 'chat', id: null, scopeIds: [a] })
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
