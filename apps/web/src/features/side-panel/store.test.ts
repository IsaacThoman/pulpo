import { describe, expect, it } from 'vitest'
import { clampPanelWidth, parsePanelContent, serializePanelContent, splitFits, useSidePanel, type PanelContent } from './store'

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
