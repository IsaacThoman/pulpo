// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab } from '@/features/files/tabs/model'
import { savePanelTabs } from '@/features/files/tabs/storage'
import { useSidePanel } from './store'
import { useSidePanelUrl } from './use-side-panel-url'

vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ user: { id: 'user' }, filesEnabled: true }) }))

const DOC = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const FOLDER = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'
const OTHER = '2b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5d'

let navigateTo: NavigateFunction = () => undefined
function Mirror() {
  useSidePanelUrl()
  navigateTo = useNavigate()
  return <output data-testid="search">{useLocation().search}</output>
}

function show(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Mirror /></MemoryRouter>)
}

const places = () => useSidePanel.getState().tabs.map((tab) => tab.location)

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '')
  useSidePanel.setState({ content: null, tabs: [], activeId: '', closed: [], owner: null, tabsEnabled: true })
  savePanelTabs('user', {
    tabs: [createTab({ kind: 'file', id: DOC }, { id: 'doc' }), createTab({ kind: 'folder', id: FOLDER }, { id: 'folder' })],
    activeId: 'doc',
    closed: [],
  })
})
afterEach(cleanup)

describe('side panel URL', () => {
  it('restores the panel’s tabs on a reload, showing the URL’s tab', async () => {
    show(`/c/chat?side=folder:${FOLDER}`)
    await waitFor(() => expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: FOLDER }))
    expect(places()).toEqual([{ kind: 'file', id: DOC }, { kind: 'folder', id: FOLDER }])
    expect(useSidePanel.getState().activeId).toBe('folder')
    expect(screen.getByTestId('search').textContent).toBe(`?side=folder:${FOLDER}`)
  })

  it('keeps the tabs hidden when the URL shows no panel', async () => {
    show('/c/chat')
    await waitFor(() => expect(places()).toHaveLength(2))
    expect(useSidePanel.getState().content).toBeNull()
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('mirrors the active tab, and shows a link’s panel in a new tab', async () => {
    show(`/c/chat?side=file:${DOC}`)
    await waitFor(() => expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: DOC }))
    act(() => useSidePanel.getState().open({ kind: 'folder', id: FOLDER }))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(`?side=folder:${FOLDER}`))

    act(() => navigateTo(`/c/other?side=file:${OTHER}`))
    await waitFor(() => expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: OTHER }))
    expect(places()).toEqual([{ kind: 'file', id: DOC }, { kind: 'folder', id: FOLDER }, { kind: 'file', id: OTHER }])
  })

  it('does not open the main view’s own file beside it from a link', async () => {
    show(`/files/d/${OTHER}?side=file:${OTHER}`)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    expect(useSidePanel.getState().content).toBeNull()
    expect(places()).toEqual([{ kind: 'file', id: DOC }, { kind: 'folder', id: FOLDER }])
    expect(useSidePanel.getState().closed).toHaveLength(0)
  })

  it('opens a folder beside the same folder in the main view, as links and reloads ask', async () => {
    show(`/files/f/${FOLDER}?side=folder:${FOLDER}`)
    await waitFor(() => expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: FOLDER }))
    expect(screen.getByTestId('search').textContent).toBe(`?side=folder:${FOLDER}`)
  })
})
