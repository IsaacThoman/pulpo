// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { applyMarkdownToYDoc } from '@pulpo/client-core/doc-schema'
import * as Y from 'yjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSidePanel } from '@/features/side-panel/store'
import { FileDocPage, FilePanelView } from './FileDocPage'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined }) })
})

vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'owner' }, filesEnabled: true }) }))
vi.mock('@/features/side-panel/agent', () => ({ usePublishFilesView: () => undefined }))
vi.mock('@/features/side-panel/AgentActions', () => ({ SplitViewButton: () => null }))
vi.mock('@/features/side-panel/PanelControls', () => ({ PanelWindowButtons: () => null }))
const sessions = vi.hoisted(() => ({ active: 0, maximum: 0, session: null as { doc: Y.Doc; provider: unknown; hasCachedContent?: boolean } | null }))
const downloadDocMarkdown = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/features/files/editor/DocEditor', () => ({ DocEditor: () => null }))
vi.mock('@/features/files/editor/use-doc-session', async () => {
  const { useEffect } = await import('react')
  return { useDocSession: () => {
    useEffect(() => {
      sessions.active++
      sessions.maximum = Math.max(sessions.maximum, sessions.active)
      return () => { sessions.active-- }
    }, [])
    return { session: sessions.session, status: { state: 'offline' }, peers: [] }
  } }
})
vi.mock('@/features/files/api', async (original) => ({
  ...await original<typeof import('@/features/files/api')>(),
  downloadDocMarkdown,
  fetchFileNode: async (id: string) => ({ node: { id, name: 'Plan.md', kind: 'doc', parentId: null, trashedAt: null }, ancestors: [] }),
}))

function Panel() {
  const content = useSidePanel((state) => state.content)
  return content?.kind === 'file' ? <FilePanelView fileId={content.id} /> : null
}

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <Routes><Route path="/files/d/:docId" element={<FileDocPage />} /><Route path="/" element={null} /></Routes>
        <Panel />
      </TooltipProvider>
    </MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  sessions.active = 0
  sessions.maximum = 0
  sessions.session = null
  downloadDocMarkdown.mockClear()
  window.history.replaceState(null, '')
  useSidePanel.setState({ content: null, lastContent: { kind: 'file', id: 'plan' } })
})
afterEach(cleanup)

describe('one document session per main and panel layout', () => {
  it('exports the open document including edits that have not reached the server', async () => {
    const doc = new Y.Doc()
    applyMarkdownToYDoc(doc, 'Saved text\n\nOffline changes 🐙')
    sessions.session = { doc, provider: {}, hasCachedContent: true }
    const view = mount('/files/d/plan')
    await waitFor(() => expect(view.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(view.getByRole('button', { name: 'Download' }))
    expect(downloadDocMarkdown).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan' }), 'Saved text\n\nOffline changes 🐙')
    doc.destroy()
  })

  it('fetches an existing document for download while its first editor sync is still pending', async () => {
    const doc = new Y.Doc()
    // Tiptap may already have initialized its empty paragraph; it is not a cached document.
    applyMarkdownToYDoc(doc, '')
    sessions.session = { doc, provider: {}, hasCachedContent: false }
    const view = mount('/files/d/plan')
    await waitFor(() => expect(view.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(view.getByRole('button', { name: 'Download' }))
    expect(downloadDocMarkdown).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan' }), undefined)
    doc.destroy()
  })

  it('does not create two sessions when a URL opens the main document in the panel too', async () => {
    useSidePanel.getState().open({ kind: 'file', id: 'plan' })
    mount('/files/d/plan?side=file:plan')
    await waitFor(() => expect(sessions.active).toBe(1))
    expect(useSidePanel.getState().content).toBeNull()
    expect(sessions.maximum).toBe(1)
  })

  it('closes a panel toggled back open for the current document before mounting another session', async () => {
    mount('/files/d/plan')
    await waitFor(() => expect(sessions.active).toBe(1))
    act(() => useSidePanel.getState().toggle())
    expect(useSidePanel.getState().content).toBeNull()
    // All renders still belong to the main view, which has its own document title.
    expect(document.querySelectorAll('input[aria-label="Document name"]')).toHaveLength(1)
    expect(sessions.maximum).toBe(1)
  })

  it('preserves a requested split while navigation away from the document is pending', async () => {
    mount('/files/d/plan')
    await waitFor(() => expect(sessions.active).toBe(1))
    act(() => {
      window.history.replaceState({ key: 'pending-navigation' }, '')
      useSidePanel.getState().open({ kind: 'file', id: 'plan' })
    })
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: 'plan' })
    expect(sessions.maximum).toBe(1)
  })

  it('opens the panel normally alongside a chat or a different main document', async () => {
    useSidePanel.getState().open({ kind: 'file', id: 'other' })
    mount('/files/d/plan')
    await waitFor(() => expect(document.querySelectorAll('input[aria-label="Document name"]')).toHaveLength(2))
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: 'other' })
    expect(sessions.active).toBe(2)
  })
})
