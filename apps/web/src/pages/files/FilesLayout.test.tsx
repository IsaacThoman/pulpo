// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { fileNodeQueryKey, folderQueryKey } from '@/features/files/api'
import { useFilesPageRequest } from '@/features/files/files-page-request'
import { useFilesNavTarget } from '@/features/files/tabs/routing'
import { useFilesTabs } from '@/features/files/tabs/store'
import { tabsStorageKey } from '@/features/files/tabs/storage'
import { FilesLayout } from './FilesLayout'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
})
const authState = vi.hoisted(() => ({ user: { id: 'user' }, filesEnabled: true as boolean }))
vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: unknown) => unknown) => selector(authState),
}))

const PROJECTS = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const DOC = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'
const ARCHIVE = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d'
const node = (id: string, name: string, kind: 'folder' | 'doc', parentId: string | null = null) => ({
  id, parentId, name, kind, status: 'ready', mimeType: kind === 'doc' ? 'text/markdown' : null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', systemRole: null,
})

let navigateTo: NavigateFunction = () => undefined
function Probe() {
  const location = useLocation()
  navigateTo = useNavigate()
  return <output data-testid="location">{location.pathname}</output>
}

function FilesButton() {
  return <Link to={useFilesNavTarget()}>{'Files button'}</Link>
}

function View({ name }: { name: string }) {
  return (
    <div>
      <p>{name}</p>
      <Link to={`/files/d/${DOC}`}>{'open doc'}</Link>
      <Link to={`/files/f/${ARCHIVE}`}>{'open archive'}</Link>
    </div>
  )
}

function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(folderQueryKey('user', null), { folder: null, ancestors: [], children: [node(PROJECTS, 'Projects', 'folder'), node(ARCHIVE, 'Archive 2025', 'folder')] })
  client.setQueryData(folderQueryKey('user', PROJECTS), { folder: node(PROJECTS, 'Projects', 'folder'), ancestors: [], children: [node(DOC, 'Roadmap.md', 'doc', PROJECTS)] })
  return client
}

function show(path = '/files', client = seededClient(), browserHistory = false) {
  const Router = ({ children }: { children: ReactNode }) => browserHistory
    ? <BrowserRouter>{children}</BrowserRouter>
    : <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  if (browserHistory) window.history.replaceState(null, '', path)
  render(
    <QueryClientProvider client={client}>
      <Router>
        <TooltipProvider>
          <FilesButton />
          <Routes>
            <Route element={<FilesLayout />}>
              <Route path="files" element={<View name="My files view" />} />
              <Route path="files/f/:folderId" element={<View name="Folder view" />} />
              <Route path="files/trash" element={<View name="Trash view" />} />
              <Route path="files/d/:docId" element={<View name="Document view" />} />
            </Route>
            <Route path="c/:chatId" element={<p>{'Chat view'}</p>} />
          </Routes>
          <Probe />
        </TooltipProvider>
      </Router>
    </QueryClientProvider>,
  )
  return client
}

const location = () => screen.getByTestId('location').textContent
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')!
const tab = (name: string) => screen.getByRole('tab', { name })

// jsdom has no PointerEvent; a mouse event of the same name carries the fields the strip reads.
function pointer(target: Element | Window, type: string, clientX: number, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX, clientY: 10 })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  fireEvent(target, event)
}

function press(target: Element) {
  pointer(target, 'pointerdown', 10)
  pointer(window, 'pointerup', 10)
}

beforeEach(() => {
  // The browser-history test leaves an entry the memory-router tests would read as current.
  window.history.replaceState(null, '', '/')
  sessionStorage.clear()
  localStorage.clear()
  useFilesTabs.setState({ owner: null, tabs: [], activeId: '', closed: [] })
  useFilesPageRequest.setState({ request: null })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  authState.filesEnabled = true
  vi.unstubAllGlobals()
  delete (window as { pulpoDesktop?: unknown }).pulpoDesktop
})

describe('Files tabs', () => {
  it('starts with a tab for the page it opened on, named after its folder', async () => {
    show(`/files/f/${PROJECTS}`)
    expect(await screen.findByRole('tablist', { name: 'Files tabs' })).toBeTruthy()
    expect(tabNames()).toEqual(['Projects'])
    expect(selectedTab().textContent).toBe('Projects')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(selectedTab().id)
  })

  it('opens My files in a new tab from the + button, and switches between tabs', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(location()).toBe('/files'))
    expect(tabNames()).toEqual(['Projects', 'My files'])
    expect(selectedTab().textContent).toBe('My files')

    press(tab('Projects'))
    await waitFor(() => expect(location()).toBe(`/files/f/${PROJECTS}`))
    expect(selectedTab().textContent).toBe('Projects')
    expect(screen.getByText('Folder view')).toBeTruthy()
  })

  it('navigates the active tab, and Back returns to the tab it came from', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(location()).toBe('/files'))
    fireEvent.click(screen.getByRole('link', { name: 'open archive' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'Archive 2025']))

    act(() => navigateTo(-1))
    await waitFor(() => expect(location()).toBe('/files'))
    expect(tabNames()).toEqual(['Projects', 'My files'])
    act(() => navigateTo(-1))
    await waitFor(() => expect(location()).toBe(`/files/f/${PROJECTS}`))
    // Back across a tab switch shows the tab that was showing, rather than moving this one.
    expect(selectedTab().textContent).toBe('Projects')
    expect(tabNames()).toEqual(['Projects', 'My files'])
  })

  it('closes tabs with ×, a middle-click, or Delete, showing a neighbor', async () => {
    show(`/files/f/${PROJECTS}`)
    const newTab = await screen.findByRole('button', { name: 'New tab' })
    fireEvent.click(newTab)
    fireEvent.click(newTab)
    await waitFor(() => expect(tabNames()).toHaveLength(3))

    // The active (last) tab's ×; the tab to its left shows.
    fireEvent.click(selectedTab().querySelector('[data-tab-close]')!)
    await waitFor(() => expect(tabNames()).toHaveLength(2))
    expect(selectedTab()).toBe(screen.getAllByRole('tab')[1])

    pointer(screen.getAllByRole('tab')[0]!, 'pointerdown', 10, 1)
    fireEvent(screen.getAllByRole('tab')[0]!, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    await waitFor(() => expect(tabNames()).toEqual(['My files']))
    expect(location()).toBe('/files')

    // A lone My files tab has nothing to close.
    expect(selectedTab().querySelector('[data-tab-close]')).toBeNull()
  })

  it('moves focus with the arrow keys, shows tabs with Enter, closes with Delete, and moves tabs with Alt+arrows', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files']))

    const projects = tab('Projects')
    act(() => projects.focus())
    fireEvent.keyDown(projects, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(tab('My files')))
    expect(tab('My files').tabIndex).toBe(0)
    expect(tab('Projects').tabIndex).toBe(-1)

    fireEvent.keyDown(tab('My files'), { key: 'ArrowLeft', altKey: true })
    expect(tabNames()).toEqual(['My files', 'Projects'])
    expect(screen.getByText('Moved My files to position 1 of 2')).toBeTruthy()

    fireEvent.keyDown(tab('Projects'), { key: 'Enter' })
    await waitFor(() => expect(location()).toBe(`/files/f/${PROJECTS}`))

    fireEvent.keyDown(tab('Projects'), { key: 'Delete' })
    await waitFor(() => expect(tabNames()).toEqual(['My files']))
    await waitFor(() => expect(location()).toBe('/files'))
  })

  it('offers browser tab actions in its menu, and reopens closed tabs', async () => {
    show(`/files/f/${PROJECTS}`)
    const newTab = await screen.findByRole('button', { name: 'New tab' })
    fireEvent.click(newTab)
    fireEvent.click(newTab)
    await waitFor(() => expect(tabNames()).toHaveLength(3))

    fireEvent.contextMenu(tab('Projects'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Close other tabs' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects']))
    expect(location()).toBe(`/files/f/${PROJECTS}`)

    fireEvent.contextMenu(screen.getByRole('tablist').parentElement!)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reopen closed tab' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files', 'My files']))
    expect(selectedTab()).toBe(screen.getAllByRole('tab')[2])

    fireEvent.contextMenu(screen.getAllByRole('tab')[2]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin tab' }))
    await waitFor(() => expect(screen.getAllByRole('tab')[0]!.hasAttribute('data-pinned')).toBe(true))

    fireEvent.contextMenu(tab('Projects'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    await waitFor(() => expect(tabNames().filter((name) => name === 'Projects')).toHaveLength(2))
  })

  it('reorders tabs by dragging, within their group', async () => {
    show(`/files/f/${PROJECTS}`)
    const newTab = await screen.findByRole('button', { name: 'New tab' })
    fireEvent.click(newTab)
    fireEvent.click(screen.getByRole('link', { name: 'open archive' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'Archive 2025']))
    fireEvent.click(newTab)
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'Archive 2025', 'My files']))

    // Lay the tabs out 100px apart.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const wrappers = [...document.querySelectorAll('[data-files-tab]')]
      const index = wrappers.indexOf(this.closest('[data-files-tab]') ?? this)
      return new DOMRect(Math.max(0, index) * 100, 0, 100, 32)
    })
    const projects = tab('Projects')
    pointer(projects, 'pointerdown', 50)
    pointer(window, 'pointermove', 120)
    pointer(window, 'pointermove', 270)
    pointer(window, 'pointerup', 270)
    rect.mockRestore()
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2025', 'My files', 'Projects']))
    // Pressing a tab shows it, as in browsers.
    expect(selectedTab().textContent).toBe('Projects')
  })

  it('lets folder tabs take dropped items, and uploads files dropped on one into its folder', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('link', { name: 'open doc' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'Roadmap.md']))

    expect(tab('Projects').getAttribute('data-drop-target')).toBe(PROJECTS)
    expect(tab('Roadmap.md').hasAttribute('data-drop-target')).toBe(false)

    const upload = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    fireEvent.drop(tab('Projects'), { dataTransfer: { types: ['Files'], files: [upload], getData: () => '' } })
    expect(useFilesPageRequest.getState().request).toEqual({ kind: 'upload', files: [upload], folderId: PROJECTS })
    await waitFor(() => expect(location()).toBe(`/files/f/${PROJECTS}`))
  })

  it('follows renames seen in any listing while a tab is in the background', async () => {
    const client = show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files']))
    act(() => {
      client.setQueryData(folderQueryKey('user', null), { folder: null, ancestors: [], children: [{ ...node(PROJECTS, 'Projects 2026', 'folder'), color: 'green' }] })
    })
    await waitFor(() => expect(tabNames()).toEqual(['Projects 2026', 'My files']))
    // The new name is kept for the next time this window opens.
    await waitFor(() => expect(sessionStorage.getItem(tabsStorageKey('user'))).toContain('Projects 2026'))
  })

  it('names a file tab from its cached item', async () => {
    const client = seededClient()
    client.setQueryData(fileNodeQueryKey('user', DOC), { node: node(DOC, 'Roadmap.md', 'doc', PROJECTS), ancestors: [] })
    show(`/files/d/${DOC}`, client)
    await waitFor(() => expect(tabNames()).toEqual(['Roadmap.md']))
    expect(document.title).toBe('Roadmap.md')
  })

  it('comes back to the active tab as it was left, and reopens tabs after a reload', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('link', { name: 'open doc' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'Roadmap.md']))
    // Inside Files, the sidebar's Files button goes to My files.
    expect(screen.getByRole('link', { name: 'Files button' }).getAttribute('href')).toBe('/files')

    act(() => navigateTo('/c/chat'))
    await waitFor(() => expect(screen.getByText('Chat view')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Files button' }).getAttribute('href')).toBe(`/files/d/${DOC}`)
    fireEvent.click(screen.getByRole('link', { name: 'Files button' }))
    await waitFor(() => expect(location()).toBe(`/files/d/${DOC}`))
    expect(tabNames()).toEqual(['Projects', 'Roadmap.md'])

    // A reload in the same window restores the tabs.
    cleanup()
    useFilesTabs.setState({ owner: null, tabs: [], activeId: '', closed: [] })
    show(`/files/d/${DOC}`)
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'Roadmap.md']))
    expect(selectedTab().textContent).toBe('Roadmap.md')
  })

  it('shows a tab already at a place when coming back to Files there', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files']))
    act(() => navigateTo('/c/chat'))
    await waitFor(() => expect(screen.getByText('Chat view')).toBeTruthy())
    act(() => navigateTo(`/files/f/${PROJECTS}`))
    await waitFor(() => expect(selectedTab().textContent).toBe('Projects'))
    expect(tabNames()).toEqual(['Projects', 'My files'])
  })

  it('takes tab keys and menu commands in the desktop app', async () => {
    let command: ((name: string) => void) | null = null
    const setFilesTabsMenu = vi.fn(async () => undefined)
    ;(window as { pulpoDesktop?: unknown }).pulpoDesktop = {
      platform: 'desktop',
      os: 'linux',
      setFilesTabsMenu,
      onCommand: (listener: (name: string) => void) => {
        command = listener
        return () => { command = null }
      },
    }
    show(`/files/f/${PROJECTS}`)
    await screen.findByRole('tablist')
    expect(setFilesTabsMenu).toHaveBeenCalledWith(true)

    act(() => command!('files-new-tab'))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files']))
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    await waitFor(() => expect(selectedTab().textContent).toBe('Projects'))
    fireEvent.keyDown(window, { key: '9', code: 'Digit9', ctrlKey: true })
    await waitFor(() => expect(selectedTab().textContent).toBe('My files'))
    act(() => command!('files-close-tab'))
    await waitFor(() => expect(tabNames()).toEqual(['Projects']))
    act(() => command!('files-reopen-tab'))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files']))

    cleanup()
    expect(setFilesTabsMenu).toHaveBeenLastCalledWith(false)
  })

  it('lists every tab and recently closed ones in the tab menu', async () => {
    show(`/files/f/${PROJECTS}`)
    const newTab = await screen.findByRole('button', { name: 'New tab' })
    fireEvent.click(newTab)
    await waitFor(() => expect(tabNames()).toHaveLength(2))
    fireEvent.click(selectedTab().querySelector('[data-tab-close]')!)
    await waitFor(() => expect(tabNames()).toHaveLength(1))

    fireEvent.keyDown(screen.getByRole('button', { name: 'List all tabs' }), { key: 'Enter' })
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Open tabs')).toBeTruthy()
    expect(within(menu).getByText('Recently closed')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'My files' }))
    await waitFor(() => expect(tabNames()).toEqual(['Projects', 'My files']))
  })

  it('goes back through a tab’s own places even where another tab shows the same one', async () => {
    show('/files', seededClient(), true)
    fireEvent.click(await screen.findByRole('link', { name: 'open archive' }))
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2025']))
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2025', 'My files']))

    act(() => window.history.back())
    await waitFor(() => expect(selectedTab()).toBe(screen.getAllByRole('tab')[0]))
    expect(location()).toBe(`/files/f/${ARCHIVE}`)
    act(() => window.history.back())
    // The first tab goes back to My files; the new tab, also at My files, does not take over.
    await waitFor(() => expect(location()).toBe('/files'))
    expect(selectedTab()).toBe(screen.getAllByRole('tab')[0])
    expect(tabNames()).toEqual(['My files', 'My files'])
    act(() => window.history.forward())
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2025', 'My files']))
    expect(selectedTab()).toBe(screen.getAllByRole('tab')[0])
  })

  it('keeps the desktop menu while moving around Files, and closes the window when there is no tab to close', async () => {
    let command: ((name: string) => void) | null = null
    const setFilesTabsMenu = vi.fn(async () => undefined)
    const closeWindow = vi.fn(async () => undefined)
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
    show('/files')
    await screen.findByRole('tablist')
    fireEvent.click(screen.getByRole('link', { name: 'open archive' }))
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2025']))
    act(() => navigateTo(-1))
    await waitFor(() => expect(location()).toBe('/files'))
    expect(setFilesTabsMenu.mock.calls).toEqual([[true]])

    act(() => command!('files-close-tab'))
    expect(closeWindow).toHaveBeenCalledTimes(1)
    expect(useFilesTabs.getState().closed).toHaveLength(0)
  })

  it('names every tab, even pinned and crowded ones that show only an icon', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Projects' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin tab' }))
    await waitFor(() => expect(tab('Projects').hasAttribute('data-pinned')).toBe(true))
    expect(tab('Projects').textContent).toBe('')
  })

  it('gives focus back to the tab when a menu opened from the keyboard closes', async () => {
    show(`/files/f/${PROJECTS}`)
    const projects = await screen.findByRole('tab', { name: 'Projects' })
    act(() => projects.focus())
    fireEvent.keyDown(projects, { key: 'F10', shiftKey: true })
    const menu = await screen.findByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Projects')))
  })

  it('lets Tab come back to the selected tab after another tab was focused', async () => {
    show(`/files/f/${PROJECTS}`)
    const projects = await screen.findByRole('tab', { name: 'Projects' })
    act(() => projects.focus())
    const newTab = screen.getByRole('button', { name: 'New tab' })
    act(() => newTab.focus())
    fireEvent.click(newTab)
    await waitFor(() => expect(selectedTab().textContent).toBe('My files'))
    expect(selectedTab().tabIndex).toBe(0)
    expect(tab('Projects').tabIndex).toBe(-1)
  })

  it('marks the selected tab in the tab list', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.click(await screen.findByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabNames()).toHaveLength(2))
    fireEvent.keyDown(screen.getByRole('button', { name: 'List all tabs' }), { key: 'Enter' })
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: 'My files' }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Projects' }).getAttribute('aria-checked')).toBe('false')
  })

  it('shows no tabs when Files is turned off and only the trash is left', async () => {
    authState.filesEnabled = false
    show('/files/trash')
    await screen.findByText('Trash view')
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('keeps a folder’s new name over an older copy written later to a stale listing', async () => {
    const client = show('/files')
    fireEvent.click(await screen.findByRole('link', { name: 'open archive' }))
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2025']))
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    act(() => {
      client.setQueryData(folderQueryKey('user', null), { folder: null, ancestors: [], children: [{ ...node(ARCHIVE, 'Archive 2026', 'folder'), revision: 2 }] })
    })
    await waitFor(() => expect(tabNames()).toEqual(['Archive 2026', 'My files']))
    // An unrelated write to a listing that still has the old name, as the sidebar's optimistic updates do.
    act(() => {
      client.setQueryData(folderQueryKey('user', ARCHIVE), { folder: { ...node(ARCHIVE, 'Archive 2025', 'folder'), revision: 1 }, ancestors: [], children: [] })
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(tabNames()).toEqual(['Archive 2026', 'My files'])
  })

  it('does not open a tab for double-clicks inside its menus', async () => {
    show(`/files/f/${PROJECTS}`)
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Projects' }))
    fireEvent.doubleClick(await screen.findByRole('menuitem', { name: 'Reopen closed tab' }))
    expect(tabNames()).toEqual(['Projects'])
  })
})
