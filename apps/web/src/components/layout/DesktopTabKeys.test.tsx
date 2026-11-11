// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { createTab } from '@/features/files/tabs/model'
import { useFilesTabs } from '@/features/files/tabs/store'
import { useSidePanel } from '@/features/side-panel/store'
import { DesktopTabKeys } from './DesktopTabKeys'

vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ user: { id: 'user' }, filesEnabled: true }) }))

const FOLDER = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const DOC = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'

let command: ((name: string) => void) | null = null
const setFilesTabsMenu = vi.fn(async (shown: boolean) => { void shown })
const closeWindow = vi.fn(async () => undefined)

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

/** The main view at `path`, beside a side panel that is open when it has content (or in its place, `full`). */
function show(path: string, full = false) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DesktopTabKeys panelFull={full} />
      <main><Routes><Route path="*" element={<button type="button">{'Main button'}</button>} /></Routes></main>
      {useSidePanel.getState().content && <aside data-side-panel data-full={full ? '' : undefined}><button type="button">{'Panel button'}</button></aside>}
      <Location />
    </MemoryRouter>,
  )
}

const panelPlaces = () => useSidePanel.getState().tabs.map((tab) => tab.location)
const panelActive = () => useSidePanel.getState().tabs.findIndex((tab) => tab.id === useSidePanel.getState().activeId)
const mainCount = () => useFilesTabs.getState().tabs.length

beforeEach(() => {
  window.history.replaceState(null, '')
  sessionStorage.clear()
  ;(window as { pulpoDesktop?: unknown }).pulpoDesktop = {
    platform: 'desktop',
    os: 'linux',
    setFilesTabsMenu,
    windowControls: { close: closeWindow },
    onCommand: (listener: (name: string) => void) => {
      command = listener
      return () => { command = null }
    },
  }
  useFilesTabs.setState({ owner: 'user', tabs: [createTab({ kind: 'folder', id: null }, { id: 'home' })], activeId: 'home', closed: [] })
  useSidePanel.setState({ content: null, tabs: [], activeId: '', closed: [], owner: null, tabsEnabled: true })
  useSidePanel.getState().open({ kind: 'folder', id: FOLDER })
  useSidePanel.getState().open({ kind: 'file', id: DOC })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as { pulpoDesktop?: unknown }).pulpoDesktop
  useFilesTabs.setState({ owner: null, tabs: [], activeId: '', closed: [] })
})

describe('desktop tab keys', () => {
  it('act on the side panel’s tabs when it was clicked last, and on the main view’s otherwise', () => {
    show('/files')
    expect(setFilesTabsMenu).toHaveBeenCalledWith(true)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Panel button' }))
    act(() => command!('files-new-tab'))
    expect(panelPlaces()).toEqual([{ kind: 'folder', id: FOLDER }, { kind: 'file', id: DOC }, { kind: 'folder', id: null }])
    expect(mainCount()).toBe(1)
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    expect(panelActive()).toBe(0)
    fireEvent.keyDown(window, { key: '9', code: 'Digit9', ctrlKey: true })
    expect(panelActive()).toBe(2)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Main button' }))
    act(() => command!('files-new-tab'))
    expect(mainCount()).toBe(2)
    expect(panelPlaces()).toHaveLength(3)
  })

  it('follow focus over the last click', () => {
    show('/files')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Main button' }))
    act(() => screen.getByRole('button', { name: 'Panel button' }).focus())
    act(() => command!('files-close-tab'))
    expect(panelPlaces()).toEqual([{ kind: 'folder', id: FOLDER }])
    expect(mainCount()).toBe(1)
  })

  it('act on the panel beside a chat, and close it after its last tab', () => {
    show('/c/chat')
    expect(setFilesTabsMenu).toHaveBeenCalledWith(true)
    act(() => command!('files-close-tab'))
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: FOLDER })
    act(() => command!('files-close-tab'))
    expect(useSidePanel.getState().content).toBeNull()
    expect(closeWindow).not.toHaveBeenCalled()
    // Without tabs in view, the File menu goes back to closing the window.
    expect(setFilesTabsMenu).toHaveBeenLastCalledWith(false)
    expect(screen.getByTestId('location').textContent).toBe('/c/chat')
  })

  it('act on a panel shown in place of the main view, whatever was clicked before', () => {
    useSidePanel.setState({ splitAvailable: false })
    show('/files', true)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Main button' }))
    act(() => command!('files-new-tab'))
    expect(panelPlaces()).toHaveLength(3)
    expect(mainCount()).toBe(1)
    useSidePanel.setState({ splitAvailable: true })
  })

  it('leave the File menu alone beside a chat while the panel has no room to show', () => {
    useSidePanel.setState({ splitAvailable: false })
    show('/c/chat')
    expect(setFilesTabsMenu).not.toHaveBeenCalled()
    useSidePanel.setState({ splitAvailable: true })
  })

  it('leave the File menu alone beside a chat when the panel is hidden', () => {
    useSidePanel.getState().close()
    show('/c/chat')
    expect(setFilesTabsMenu).not.toHaveBeenCalled()
  })

  it('go to the panel after a click inside it, even when what was clicked is gone (a folder opened from its rows)', () => {
    show('/files')
    const button = screen.getByRole('button', { name: 'Panel button' })
    fireEvent.pointerDown(button)
    button.remove()
    const before = useSidePanel.getState().tabs.length
    act(() => command!('files-close-tab'))
    expect(useSidePanel.getState().tabs).toHaveLength(before - 1)
    expect(mainCount()).toBe(1)
    expect(closeWindow).not.toHaveBeenCalled()
  })

  it('close the panel’s tabs from a lone My files tab, then the window', () => {
    show('/files')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Main button' }))
    act(() => command!('files-close-tab'))
    expect(panelPlaces()).toEqual([{ kind: 'folder', id: FOLDER }])
    act(() => command!('files-close-tab'))
    expect(useSidePanel.getState().content).toBeNull()
    expect(closeWindow).not.toHaveBeenCalled()
    act(() => command!('files-close-tab'))
    expect(closeWindow).toHaveBeenCalledTimes(1)
    expect(mainCount()).toBe(1)
  })

  it('close the main view’s last tab, going back to My files, then the window from a lone My files tab', async () => {
    useSidePanel.getState().close()
    useFilesTabs.setState({ tabs: [createTab({ kind: 'folder', id: FOLDER }, { id: 'folder' })], activeId: 'folder' })
    show(`/files/f/${FOLDER}`)
    act(() => command!('files-close-tab'))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/files'))
    expect(useFilesTabs.getState().tabs.map((tab) => tab.location)).toEqual([{ kind: 'folder', id: null }])
    expect(closeWindow).not.toHaveBeenCalled()

    act(() => command!('files-close-tab'))
    expect(closeWindow).toHaveBeenCalledTimes(1)
    expect(mainCount()).toBe(1)
  })
})
