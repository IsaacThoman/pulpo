// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTab, type FilesTabsData } from './model'
import { clearStoredPanelTabs, clearStoredTabs, loadPanelTabs, loadTabs, panelTabsStorageKey, parsePanelTabs, parseTabs, saveTabs, savePanelTabs, serializeTabs, tabsStorageKey } from './storage'

const FOLDER = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const DOC = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'

function sample(): FilesTabsData {
  const root = createTab({ kind: 'folder', id: null }, { id: 'root-tab', pinned: true })
  const folder = createTab({ kind: 'folder', id: FOLDER }, { id: 'folder-tab', snapshot: { kind: 'folder', name: 'Projects', mimeType: null, color: 'green' } })
  const doc = createTab({ kind: 'file', id: DOC }, { id: 'doc-tab', openerId: 'folder-tab' })
  const trash = createTab({ kind: 'folder', id: `trash:${FOLDER}` }, { id: 'trash-tab' })
  return { tabs: [root, folder, doc], activeId: 'doc-tab', closed: [{ tabs: [{ tab: trash, index: 3 }] }] }
}

function clearStorage() {
  try { localStorage.clear() } catch { /* not available */ }
  try { sessionStorage.clear() } catch { /* not available */ }
}

beforeEach(clearStorage)
afterEach(() => {
  clearStorage()
  delete (window as { pulpoDesktop?: unknown }).pulpoDesktop
})

describe('stored Files tabs', () => {
  it('round-trips tabs, the active tab, and closed tabs', () => {
    expect(parseTabs(serializeTabs(sample()))).toEqual(sample())
  })

  it('reads nothing from missing, corrupt, or foreign data', () => {
    expect(parseTabs(null)).toBeNull()
    expect(parseTabs('{')).toBeNull()
    expect(parseTabs(JSON.stringify({ v: 2, tabs: [], activeId: '' }))).toBeNull()
    expect(parseTabs(JSON.stringify({ v: 1, tabs: [{ id: 'x', location: 'chat:1' }], activeId: 'x' }))).toBeNull()
  })

  it('drops malformed tabs, duplicate ids, and attachments, and keeps pinned tabs first', () => {
    const data = parseTabs(JSON.stringify({
      v: 1,
      activeId: 'missing',
      tabs: [
        { id: 'a', location: `folder:${FOLDER}` },
        { id: 'a', location: 'folder:root' },
        { id: 'b', location: `attachment:${DOC}` },
        { id: 'c', location: 'folder:trash', pinned: true, snapshot: { name: 7 } },
        { location: 'folder:root' },
      ],
    }))!
    expect(data.tabs.map((tab) => tab.id)).toEqual(['c', 'a'])
    expect(data.tabs[0]!.snapshot).toBeNull()
    // An active tab that is not there falls back to the first.
    expect(data.activeId).toBe('c')
  })

  it('keeps tabs per account and window on the web', () => {
    saveTabs('one', sample())
    expect(loadTabs('one')?.activeId).toBe('doc-tab')
    expect(loadTabs('two')).toBeNull()
    expect(sessionStorage.getItem(tabsStorageKey('one'))).not.toBeNull()
    // A new browser tab starts fresh, as a new browser window does.
    expect(localStorage.getItem(tabsStorageKey('one'))).toBeNull()
  })

  it('keeps tabs across launches in the desktop app', () => {
    (window as { pulpoDesktop?: unknown }).pulpoDesktop = { platform: 'desktop' }
    saveTabs('one', sample())
    sessionStorage.clear()
    expect(loadTabs('one')?.tabs.map((tab) => tab.id)).toEqual(['root-tab', 'folder-tab', 'doc-tab'])
  })

  it('forgets an account’s tabs', () => {
    (window as { pulpoDesktop?: unknown }).pulpoDesktop = { platform: 'desktop' }
    saveTabs('one', sample())
    clearStoredTabs('one')
    expect(loadTabs('one')).toBeNull()
    expect(localStorage.getItem(tabsStorageKey('one'))).toBeNull()
  })

  it('keeps closed tabs after every tab was closed, so they can be reopened', () => {
    const data = { tabs: [], activeId: '', closed: sample().closed }
    expect(parseTabs(serializeTabs(data))).toEqual(data)
    expect(parseTabs(serializeTabs({ tabs: [], activeId: '', closed: [] }))).toBeNull()
  })
})

describe('stored side panel tabs', () => {
  const attachment = createTab({ kind: 'attachment', id: DOC }, { id: 'photo-tab', snapshot: { kind: 'blob', name: 'photo.png', mimeType: 'image/png' } })

  it('keeps attachments, apart from the main view’s tabs', () => {
    const data = { tabs: [...sample().tabs, attachment], activeId: 'photo-tab', closed: [] }
    savePanelTabs('one', data)
    expect(loadPanelTabs('one')).toEqual(data)
    expect(sessionStorage.getItem(panelTabsStorageKey('one'))).not.toBeNull()
    expect(loadTabs('one')).toBeNull()
    // The main view never reads an attachment.
    expect(parseTabs(serializeTabs(data))?.tabs.map((tab) => tab.id)).toEqual(['root-tab', 'folder-tab', 'doc-tab'])
  })

  it('keeps closed attachments, with no tabs open, only for the side panel', () => {
    const data = { tabs: [], activeId: '', closed: [{ tabs: [{ tab: attachment, index: 0 }] }] }
    expect(parsePanelTabs(serializeTabs(data))).toEqual(data)
    // The main view keeps closed tabs with none open too, but not attachments, which it never shows.
    expect(parseTabs(serializeTabs(data))).toBeNull()
    expect(parsePanelTabs(serializeTabs({ tabs: [], activeId: '', closed: [] }))).toBeNull()
  })

  it('forgets an account’s panel tabs', () => {
    (window as { pulpoDesktop?: unknown }).pulpoDesktop = { platform: 'desktop' }
    savePanelTabs('one', { tabs: [attachment], activeId: 'photo-tab', closed: [] })
    sessionStorage.clear()
    expect(loadPanelTabs('one')?.tabs).toHaveLength(1)
    clearStoredPanelTabs('one')
    expect(loadPanelTabs('one')).toBeNull()
  })
})
