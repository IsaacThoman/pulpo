// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import * as Y from 'yjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSidePanel } from '@/features/side-panel/store'
import type { LiveEditorProps } from '@/features/files/live/types'
import { FileDocPage, FilePanelView } from './FileDocPage'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined }) })
})

const state = vi.hoisted(() => ({
  status: { state: 'synced' } as { state: string },
  listeners: new Set<() => void>(),
  session: null as { doc: unknown; provider: unknown; hasCachedContent?: boolean } | null,
  print: (() => {}) as () => void,
}))

/** The mocked session's sync state changes, as the provider reports them. */
function setStatus(next: string) {
  state.status = { state: next }
  for (const listener of state.listeners) listener()
}
const api = vi.hoisted(() => ({
  copyFileNodes: vi.fn(async (_ids: string[], parentId: string | null) => [{ id: 'copy', parentId, name: 'Report (2).docx', kind: 'doc' }]),
  trashFileNodes: vi.fn(async (ids: string[]) => ids),
  restoreFileNodes: vi.fn(async () => []),
  createDoc: vi.fn(async (parentId: string | null, name: string) => ({ id: 'created', parentId, name, kind: 'doc', format: 'sheet' })),
  updateFileNode: vi.fn(async () => ({})),
}))

function node(id: string, name: string, format: string, parentId: string | null = 'folder'): FileNode {
  return {
    id, name, kind: 'doc', format, parentId, trashedAt: null, revision: 3, sizeBytes: 2048, mimeType: null, status: 'ready',
    createdAt: '2026-01-02T10:00:00.000Z', updatedAt: '2026-03-04T15:30:00.000Z', pinned: false,
  } as FileNode
}

vi.mock('@/stores/auth', () => ({ useAuth: (selector: (value: unknown) => unknown) => selector({ user: { id: 'owner' }, filesEnabled: true, officeConversionEnabled: false }) }))
vi.mock('@/features/side-panel/agent', () => ({ usePublishFilesView: () => undefined, runWithAgent: () => undefined }))
vi.mock('@/features/side-panel/AgentActions', () => ({ SplitViewButton: () => null }))
vi.mock('@/features/side-panel/PanelControls', () => ({ PanelWindowButtons: () => null }))
vi.mock('@/features/sidebar/api', () => ({ pinSidebarItems: vi.fn(async () => {}) }))
vi.mock('@/features/files/editor/use-doc-session', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    state.listeners.add(listener)
    return () => { state.listeners.delete(listener) }
  }
  return { useDocSession: () => ({ session: state.session, status: useSyncExternalStore(subscribe, () => state.status), peers: [] }) }
})
vi.mock('@/features/files/api', async (original) => ({
  ...await original<typeof import('@/features/files/api')>(),
  ...api,
  fetchFileNode: async (id: string) => ({
    node: id === 'created' ? node('created', 'Untitled spreadsheet.xlsx', 'sheet') : node(id, id === 'other' ? 'Other.docx' : 'Report.docx', 'document'),
    ancestors: [{ ...node('folder', 'Plans', ''), kind: 'folder', parentId: null }],
  }),
}))

// A stand-in for the lazy editors: the shared menu bar and keys over the props Files passes.
vi.mock('@/features/files/live/registry', async () => {
  const { EditorMenuBar } = await import('@/features/files/live/chrome/EditorMenuBar')
  const { fileMenuDefinition } = await import('@/features/files/live/chrome/file-menu')
  const { useEditorShortcuts } = await import('@/features/files/live/chrome/use-editor-shortcuts')
  function Editor({ fileMenu, onSaveShortcut, name }: LiveEditorProps) {
    const root = useRef<HTMLDivElement>(null)
    useEditorShortcuts(root, { save: onSaveShortcut, focus: () => root.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus() })
    return (
      <div ref={root} data-file-editor="document">
        <EditorMenuBar menus={[fileMenuDefinition(fileMenu, () => ({ print: () => state.print() }))]} />
        <div role="textbox" tabIndex={0} aria-label={`Body of ${name}`} />
      </div>
    )
  }
  const { FileSpreadsheet, FileText } = await import('lucide-react')
  const entry = (id: string, typeLabel: string, newName: string, icon: typeof FileText) => ({
    format: { id }, typeLabel: () => typeLabel, newLabel: () => `New ${typeLabel}`, newName: () => newName, icon, Editor, Diff: () => null, exportFile: async () => new Uint8Array([1]),
  })
  const formats = [entry('document', 'Word document', 'Untitled document.docx', FileText), entry('sheet', 'Spreadsheet', 'Untitled spreadsheet.xlsx', FileSpreadsheet)]
  return {
    LIVE_WEB_FORMATS: formats,
    liveFormatsForNew: () => formats,
    liveWebFormat: (value: { kind: string; format?: string | null }) => formats.find((format) => value.kind === 'doc' && format.format.id === value.format) ?? null,
  }
})

function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>
}

function Panel() {
  const content = useSidePanel((value) => value.content)
  return content?.kind === 'file' ? <FilePanelView fileId={content.id} /> : null
}

function mount(path = '/files/d/report') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>
          <Routes>
            <Route path="/files/d/:docId" element={<FileDocPage />} />
            <Route path="/files/f/:folderId" element={null} />
            <Route path="/" element={null} />
          </Routes>
          <Panel />
          <Where />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const where = () => screen.getByRole('status', { name: 'Location' }).textContent
const title = () => screen.getByRole('textbox', { name: 'Document name' }) as HTMLInputElement

async function fileMenuItem(name: string) {
  const file = await screen.findByRole('menuitem', { name: 'File' })
  fireEvent.keyDown(file, { key: 'Enter' })
  return screen.findByRole('menuitem', { name })
}

beforeEach(() => {
  state.status = { state: 'synced' }
  state.listeners.clear()
  state.session = { doc: new Y.Doc(), provider: {}, hasCachedContent: true }
  for (const spy of Object.values(api)) spy.mockClear()
  useSidePanel.setState({ content: null, lastContent: null })
  document.title = 'Pulpo'
})
afterEach(cleanup)

describe('the File menu Files gives a live document', () => {
  it('makes a copy beside the document and opens it', async () => {
    mount()
    fireEvent.click(await fileMenuItem('Make a copy'))
    await waitFor(() => expect(where()).toBe('/files/d/copy'))
    expect(api.copyFileNodes).toHaveBeenCalledWith(['report'], 'folder')
  })

  it('moves the document to the trash and goes back to its folder', async () => {
    mount()
    fireEvent.click(await fileMenuItem('Move to trash'))
    await waitFor(() => expect(where()).toBe('/files/f/folder'))
    expect(api.trashFileNodes).toHaveBeenCalledWith(['report'])
  })

  it('creates a new spreadsheet in the same folder and opens it with its name selected', async () => {
    mount()
    const file = await screen.findByRole('menuitem', { name: 'File' })
    fireEvent.keyDown(file, { key: 'Enter' })
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'New' }), { key: 'ArrowRight' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Spreadsheet' }))
    await waitFor(() => expect(where()).toBe('/files/d/created'))
    expect(api.createDoc).toHaveBeenCalledWith('folder', 'Untitled spreadsheet.xlsx')
    await waitFor(() => expect(title().value).toBe('Untitled spreadsheet.xlsx'))
    await waitFor(() => expect(document.activeElement).toBe(title()))
    expect([title().selectionStart, title().selectionEnd]).toEqual([0, 'Untitled spreadsheet'.length])
  })

  it('copies the link and shows details', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mount()
    fireEvent.click(await fileMenuItem('Copy link'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/files/d/report`))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.click(await fileMenuItem('Details'))
    const details = await screen.findByRole('dialog', { name: 'Report.docx' })
    expect(details.textContent).toContain('Word document (.docx)')
    expect(details.textContent).toContain('My files › Plans')
    expect(details.textContent).toContain('2.0 KiB')
  })

  it('renames from the File menu by selecting the name in the title', async () => {
    mount()
    fireEvent.click(await fileMenuItem('Rename'))
    await waitFor(() => expect(document.activeElement).toBe(title()))
    expect([title().selectionStart, title().selectionEnd]).toEqual([0, 'Report'.length])
  })

  it('downloads and prints through the editor', async () => {
    const print = vi.fn()
    state.print = print
    mount()
    const file = await screen.findByRole('menuitem', { name: 'File' })
    fireEvent.keyDown(file, { key: 'Enter' })
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Download' }), { key: 'ArrowRight' })
    expect(await screen.findByRole('menuitem', { name: 'Microsoft Word (.docx)' })).toBeTruthy()
    // Without the office converter, PDFs come from the browser's print dialog.
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF (print, then save as PDF)' }))
    expect(print).toHaveBeenCalledOnce()
  })
})

describe('the document title', () => {
  it('keeps the type: typing over the whole name keeps the extension', async () => {
    mount()
    await waitFor(() => expect(title().value).toBe('Report.docx'))
    fireEvent.focus(title())
    fireEvent.change(title(), { target: { value: ' Q3 plan ' } })
    fireEvent.blur(title())
    await waitFor(() => expect(api.updateFileNode).toHaveBeenCalledWith('report', { name: 'Q3 plan.docx', expectedRevision: 3 }))
  })

  it("refuses another format's extension or an invalid name, and Escape restores it", async () => {
    mount()
    await waitFor(() => expect(title().value).toBe('Report.docx'))
    fireEvent.change(title(), { target: { value: 'Report.xlsx' } })
    fireEvent.keyDown(title(), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Keep the .docx extension: another one would change what kind of file this is.')
    fireEvent.change(title(), { target: { value: 'a/b' } })
    fireEvent.keyDown(title(), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Names cannot contain "/" or control characters')
    fireEvent.keyDown(title(), { key: 'Escape' })
    expect(title().value).toBe('Report.docx')
    expect(api.updateFileNode).not.toHaveBeenCalled()
  })

  it('returns to the document after Enter', async () => {
    mount()
    await waitFor(() => expect(title().value).toBe('Report.docx'))
    title().focus()
    fireEvent.change(title(), { target: { value: 'Report final.docx' } })
    fireEvent.keyDown(title(), { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Body of Report.docx' })))
    await waitFor(() => expect(api.updateFileNode).toHaveBeenCalledWith('report', { name: 'Report final.docx', expectedRevision: 3 }))
  })

  it('names the browser tab after the document in the main view only', async () => {
    useSidePanel.getState().open({ kind: 'file', id: 'other' })
    const view = mount()
    await waitFor(() => expect(document.title).toBe('Report'))
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: 'Document name' })).toHaveLength(2))
    expect(document.title).toBe('Report')
    view.unmount()
    expect(document.title).toBe('Pulpo')
  })
})

describe('the save status', () => {
  it('says Saved, confirms Cmd/Ctrl+S, and says Offline', async () => {
    const view = mount()
    const status = await waitFor(() => {
      const element = view.container.querySelector('[data-sync-state]')
      if (!element) throw new Error('no status')
      return element
    })
    expect(status.textContent).toBe('Saved')
    expect(status.getAttribute('data-sync-state')).toBe('synced')
    const body = await screen.findByRole('textbox', { name: 'Body of Report.docx' })
    const press = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
    act(() => { body.dispatchEvent(press) })
    expect(press.defaultPrevented).toBe(true)
    await waitFor(() => expect(view.container.querySelector('[data-sync-state]')?.textContent).toBe('All changes saved'))
    expect(screen.getAllByRole('status').some((element) => element.textContent === 'All changes saved')).toBe(true)
  })

  it('shows Saving… only when a save takes a while, and Offline at once', async () => {
    const view = mount()
    const saveState = () => view.container.querySelector('[data-save-state]')?.getAttribute('data-save-state')
    await waitFor(() => expect(saveState()).toBe('saved'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      // Typing: each keystroke's save is acknowledged quickly, so the status never flickers.
      for (let key = 0; key < 5; key++) {
        act(() => setStatus('syncing'))
        await act(async () => { await vi.advanceTimersByTimeAsync(100) })
        act(() => setStatus('synced'))
        await act(async () => { await vi.advanceTimersByTimeAsync(50) })
        expect(saveState()).toBe('saved')
      }
      act(() => setStatus('syncing'))
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(saveState()).toBe('saved')
      await act(async () => { await vi.advanceTimersByTimeAsync(200) })
      expect(saveState()).toBe('saving')
      expect(view.container.querySelector('[data-save-state]')?.textContent).toBe('Saving…')
      // Once shown it stays a moment, then the save is confirmed.
      act(() => setStatus('synced'))
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      expect(saveState()).toBe('saving')
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(saveState()).toBe('saved')
      act(() => setStatus('offline'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(view.container.querySelector('[data-save-state]')?.textContent).toBe('Offline')
    } finally {
      vi.useRealTimers()
    }
  })
})
