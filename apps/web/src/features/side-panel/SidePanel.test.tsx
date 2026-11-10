// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { attachmentQueryKey } from '@/components/chat/attachment-actions'
import { useFilesPageRequest } from '@/features/files/files-page-request'
import { SidePanel } from './SidePanel'
import { useSidePanel } from './store'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
})
const authState = vi.hoisted(() => ({ user: { id: 'user' }, filesEnabled: true, urlImportEnabled: false }))
vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector(authState) }))
vi.mock('@/features/side-panel/agent', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/side-panel/agent')>(),
  usePublishFilesView: () => undefined,
}))
vi.mock('@/features/side-panel/AgentActions', () => ({ OpenChatToLeftItem: () => null, AgentMenuItems: () => null, SplitViewButton: () => null }))

const PROJECTS = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const PHOTO = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'
const projects = { id: PROJECTS, parentId: null, name: 'Projects', kind: 'folder', updatedAt: '2026-11-01T00:00:00Z' }
const uploadFile = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/features/files/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/files/api')>(),
  uploadFile,
  fetchFolder: async (folderId: string | null) => folderId === PROJECTS
    ? { folder: projects, ancestors: [], children: [] }
    : { folder: null, ancestors: [], children: [projects] },
  fetchFolderLayout: async () => ({ folderId: null, positions: {}, snapToGrid: true }),
}))

function Location() {
  const { pathname } = useLocation()
  return <output data-testid="location">{pathname}</output>
}

function show(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }), full = false) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/c/chat']}>
        <TooltipProvider>
          <SidePanel available={full ? 390 : 1400} full={full} />
        </TooltipProvider>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const tabNames = () => within(screen.getByRole('tablist', { name: 'Side panel tabs' })).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))
const places = () => useSidePanel.getState().tabs.map((tab) => tab.location)

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '')
  useSidePanel.setState({ content: null, tabs: [], activeId: '', closed: [], owner: null, tabsEnabled: true, splitAvailable: true })
  useFilesPageRequest.setState({ request: null })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  authState.filesEnabled = true
})

describe('side panel tabs', () => {
  it('shows its tabs at the top, with the window buttons there instead of in the view’s header', async () => {
    useSidePanel.getState().open({ kind: 'folder', id: PROJECTS })
    useSidePanel.getState().open({ kind: 'folder', id: null })
    show()
    await screen.findByRole('heading', { name: 'My files' })
    await screen.findByRole('tab', { name: 'Projects' })
    expect(tabNames()).toEqual(['Projects', 'My files'])
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'My files' }).id)
    expect(screen.getByRole('tab', { name: 'My files' }).id).toMatch(/^panel-tab-/)
    // One set of window buttons, on the strip.
    for (const name of ['Open in new browser tab', 'Open in main view', 'Close panel']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(1)
      expect(within(panel).queryByRole('button', { name })).toBeNull()
    }
  })

  it('moves its tab to the main view, hiding the panel after the last one', async () => {
    useSidePanel.getState().open({ kind: 'folder', id: PROJECTS })
    useSidePanel.getState().open({ kind: 'folder', id: null })
    show()
    await screen.findByRole('heading', { name: 'My files' })
    fireEvent.click(screen.getByRole('button', { name: 'Open in main view' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/files'))
    expect(places()).toEqual([{ kind: 'folder', id: PROJECTS }])
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: PROJECTS })

    fireEvent.click(await screen.findByRole('button', { name: 'Open in main view' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/files/f/${PROJECTS}`))
    expect(useSidePanel.getState().content).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('hides in place of the main view when a tab moves there, so the main view shows it', async () => {
    useSidePanel.getState().open({ kind: 'folder', id: PROJECTS })
    useSidePanel.getState().open({ kind: 'folder', id: null })
    useSidePanel.setState({ splitAvailable: false })
    show(undefined, true)
    await screen.findByRole('heading', { name: 'My files' })
    fireEvent.click(screen.getByRole('button', { name: 'Open in main view' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/files'))
    expect(useSidePanel.getState().content).toBeNull()
    // The other tab stays for the next time the panel opens.
    expect(places()).toEqual([{ kind: 'folder', id: PROJECTS }])
  })

  it('moves a tab from its menu, and hides the panel with its tabs kept', async () => {
    useSidePanel.getState().open({ kind: 'folder', id: PROJECTS })
    useSidePanel.getState().open({ kind: 'folder', id: null })
    show()
    await screen.findByRole('heading', { name: 'My files' })
    // The background tab is named once the listing beside it is cached.
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Projects' }))
    expect(screen.queryByRole('menuitem', { name: 'Open to the right' })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in main view' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/files/f/${PROJECTS}`))
    expect(places()).toEqual([{ kind: 'folder', id: null }])

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(useSidePanel.getState().content).toBeNull()
    expect(places()).toEqual([{ kind: 'folder', id: null }])
  })

  it('names attachment tabs from their cached data, and opens My files from +', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    client.setQueryData(attachmentQueryKey('user', PHOTO), { id: PHOTO, name: 'photo.png', mimeType: 'image/png', size: 10, type: 'image', chatId: null })
    useSidePanel.getState().open({ kind: 'attachment', id: PHOTO })
    useSidePanel.getState().open({ kind: 'folder', id: PROJECTS })
    show(client)
    await screen.findByRole('heading', { name: 'Projects' })
    await waitFor(() => expect(tabNames()).toEqual(['photo.png', 'Projects']))
    // The look is kept with the tab for the next time the window opens.
    await waitFor(() => expect(useSidePanel.getState().tabs[0]!.snapshot).toMatchObject({ kind: 'blob', name: 'photo.png', mimeType: 'image/png' }))

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabNames()).toEqual(['photo.png', 'Projects', 'My files']))
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: null })
  })

  it('uploads files dropped on a folder tab with the panel’s own browser', async () => {
    useSidePanel.getState().open({ kind: 'folder', id: PROJECTS })
    useSidePanel.getState().open({ kind: 'folder', id: null })
    show()
    await screen.findByRole('heading', { name: 'My files' })
    const upload = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    fireEvent.drop(await screen.findByRole('tab', { name: 'Projects' }), { dataTransfer: { types: ['Files'], files: [upload], getData: () => '' } })
    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(PROJECTS, upload))
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: PROJECTS })
    expect(useFilesPageRequest.getState().request).toBeNull()
  })

  it('closes the panel after its last tab closes', async () => {
    useSidePanel.getState().open({ kind: 'folder', id: null })
    show()
    await screen.findByRole('heading', { name: 'My files' })
    // Unlike the main view, a lone My files tab closes too.
    const tab = screen.getByRole('tab', { name: 'My files' })
    act(() => tab.focus())
    fireEvent.keyDown(tab, { key: 'Delete' })
    await waitFor(() => expect(useSidePanel.getState().content).toBeNull())
    expect(places()).toEqual([])
    act(() => useSidePanel.getState().toggle())
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: null })
  })

  it('keeps the window buttons in the header and shows no tabs when Files is turned off', async () => {
    authState.filesEnabled = false
    useSidePanel.getState().open({ kind: 'folder', id: 'trash' })
    show()
    await screen.findByRole('heading', { name: 'Trash' })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Open in main view' })).toBeTruthy()
  })
})
