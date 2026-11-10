// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FileNode } from '@pulpo/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => null, clearWebComposerSync() {} }))
vi.mock('@/lib/local-first/database', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, localAccountKey: (id: string) => id, localDb: {
    drafts: {
      where: () => ({ equals: () => ({ first: async () => undefined, delete: async () => {} }) }),
      put: async () => {},
    },
  } }
})
const api = vi.hoisted(() => ({ fetchFileNode: vi.fn(), searchFiles: vi.fn() }))
vi.mock('@/features/files/api', async (actual) => ({ ...await actual<object>(), fetchFileNode: api.fetchFileNode, searchFiles: api.searchFiles }))

const { Composer } = await import('./Composer')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { getCatalogModel, useCatalog } = await import('@/stores/catalog')
const catalog = useCatalog.getState()
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft, runtimeComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { addToChat, useChatTarget, usePendingReferences } = await import('@/features/side-panel/agent')
const { queryClient } = await import('@/lib/query-client')

const chatId = '11111111-1111-4111-8111-111111111111'
const plan: FileNode = {
  id: '00000000-0000-4000-8000-0000000000a1', parentId: null, kind: 'doc', name: 'Plan.md', status: 'ready',
  mimeType: 'text/markdown', sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}
const notes: FileNode = { ...plan, id: '00000000-0000-4000-8000-0000000000a2', kind: 'folder', name: 'Notes', mimeType: null }
const planning: FileNode = { ...plan, id: '00000000-0000-4000-8000-0000000000a3', kind: 'blob', name: 'Planning 2026.pdf', mimeType: 'application/pdf' }
const nodes = new Map([[plan.id, plan], [notes.id, notes], [planning.id, planning]])
const work = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Work' }

beforeEach(() => {
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, filesEnabled: true })
  useSettings.setState({ composerSyncEnabled: false, agentModes: { model: false } })
  useUploadOutbox.setState({ uploads: {}, submissions: [] })
  useCatalog.setState({ agentAvailable: catalog.agentAvailable, models: catalog.models })
  usePendingReferences.setState({ target: null, ids: [] })
  queryClient.clear()
  clearRuntimeComposerDrafts('account')
  api.fetchFileNode.mockImplementation(async (id: string) => ({ node: nodes.get(id), ancestors: [] }))
  api.searchFiles.mockImplementation(async (query: string) => ({
    items: [plan, planning, notes]
      .filter((node) => node.name.toLowerCase().includes(query.toLowerCase()))
      .map((node) => ({ node, parent: node === planning ? work : null })),
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderComposer({ canReferenceFiles = true } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><TooltipProvider><Composer chatId={chatId} modelId="model" syncEnabled={false} canReferenceFiles={canReferenceFiles} /></TooltipProvider></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Focuses the message box and types `text` into it, caret at the end. */
function type(input: HTMLTextAreaElement, text: string) {
  act(() => input.focus())
  fireEvent.change(input, { target: { value: text } })
}

it('shows a draft’s references as chips and keeps them while typing and removing', async () => {
  rememberRuntimeComposerDraft('account', chatId, {
    content: `Compare these \n\n[Plan.md](/files/d/${plan.id}) [Notes](/files/f/${notes.id})`, attachments: [], attachmentIds: [],
  })
  const view = renderComposer()
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  expect(input.value).toBe('Compare these ')
  expect(await view.findByRole('button', { name: 'Open Plan.md in Files' })).toBeTruthy()
  expect(await view.findByRole('button', { name: 'Open Notes in Files' })).toBeTruthy()
  expect(view.getAllByText('In Files · My files')).toHaveLength(2)

  fireEvent.change(input, { target: { value: 'Compare these two' } })
  await waitFor(() => expect(runtimeComposerDraft('account', chatId)?.content)
    .toBe(`Compare these two\n\n[Plan.md](/files/d/${plan.id}) [Notes](/files/f/${notes.id})`))

  fireEvent.click(view.getByRole('button', { name: 'Remove Plan.md' }))
  await waitFor(() => expect(runtimeComposerDraft('account', chatId)?.content).toBe(`Compare these two\n\n[Notes](/files/f/${notes.id})`))
  expect(input.value).toBe('Compare these two')
})

it('adds items sent from Files to the message', async () => {
  useChatTarget.setState({ target: { kind: 'chat', id: chatId } })
  const view = renderComposer()
  await act(async () => { addToChat([plan.id, 'root']) })
  expect(await view.findByRole('button', { name: 'Open Plan.md in Files' })).toBeTruthy()
  await waitFor(() => expect(runtimeComposerDraft('account', chatId)?.content).toBe(`\n\n[Plan.md](/files/d/${plan.id})`))
  expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  expect(usePendingReferences.getState().ids).toEqual([])
})

it('requires Agent mode to send a message that mentions Files items', async () => {
  useCatalog.setState({ agentAvailable: true, models: [{ ...getCatalogModel(''), id: 'model', enabled: true, agentEnabled: true }] })
  rememberRuntimeComposerDraft('account', chatId, { content: `Read this\n\n[Plan.md](/files/d/${plan.id})`, attachments: [], attachmentIds: [] })
  const view = renderComposer()
  expect(await view.findByText('Files items require Agent mode.')).toBeTruthy()
  const send = view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement
  expect(send.disabled).toBe(true)

  fireEvent.click(view.getByRole('button', { name: 'Enable Agent' }))
  await waitFor(() => expect(view.queryByText('Files items require Agent mode.')).toBeNull())
  expect(send.disabled).toBe(false)
})

it('says so when the model cannot use the mentioned Files items', async () => {
  useCatalog.setState({ agentAvailable: true, models: [{ ...getCatalogModel(''), id: 'model', enabled: true, agentEnabled: false }] })
  rememberRuntimeComposerDraft('account', chatId, { content: `Read this\n\n[Plan.md](/files/d/${plan.id})`, attachments: [], attachmentIds: [] })
  const view = renderComposer()
  expect(await view.findByText('Switch to an Agent-capable model or remove the Files items.')).toBeTruthy()
  expect((view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.queryByRole('button', { name: 'Enable Agent' })).toBeNull()

  // Without the items, the same text sends as an ordinary message.
  fireEvent.click(view.getByRole('button', { name: 'Remove Plan.md' }))
  await waitFor(() => expect(view.queryByText('Switch to an Agent-capable model or remove the Files items.')).toBeNull())
  expect((view.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false)
})

it('suggests Files items for an @ word and mentions the one chosen with Enter', async () => {
  useCatalog.setState({ agentAvailable: true, models: [{ ...getCatalogModel(''), id: 'model', enabled: true, agentEnabled: true }] })
  const view = renderComposer()
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  type(input, 'summarize @pl')
  const list = await view.findByRole('listbox', { name: 'Files' })
  const options = view.getAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual(['Plan.mdMy files', 'Planning 2026.pdfWork'])
  expect(api.searchFiles).toHaveBeenLastCalledWith('pl', 8, expect.anything())
  expect(input.getAttribute('aria-controls')).toBe(list.id)
  expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
  // The list leaves focus in the message box.
  expect(document.activeElement).toBe(input)

  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(input.value).toBe('summarize Plan.md '))
  expect(view.queryByRole('listbox')).toBeNull()
  expect(await view.findByRole('button', { name: 'Open Plan.md in Files' })).toBeTruthy()
  await waitFor(() => expect(runtimeComposerDraft('account', chatId)?.content).toBe(`summarize Plan.md \n\n[Plan.md](/files/d/${plan.id})`))
  // Mentioning an item turns Agent mode on, as Add from Files does.
  expect(view.queryByText('Files items require Agent mode.')).toBeNull()
  await waitFor(() => expect(input.selectionStart).toBe('summarize Plan.md '.length))
})

it('moves through suggestions with the arrow keys, leaves out mentioned items, and picks with a click', async () => {
  rememberRuntimeComposerDraft('account', chatId, { content: `\n\n[Notes](/files/f/${notes.id})`, attachments: [], attachmentIds: [] })
  const view = renderComposer()
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  type(input, 'compare @')
  await view.findByRole('listbox', { name: 'Files' })
  expect(view.getByText('Recent in Files')).toBeTruthy()
  expect(view.getAllByRole('option').map((option) => option.textContent)).toEqual(['Plan.mdMy files', 'Planning 2026.pdfWork'])
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(input.getAttribute('aria-activedescendant')).toBe(view.getAllByRole('option')[1]!.id)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(view.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  fireEvent.click(view.getAllByRole('option')[1]!)
  await waitFor(() => expect(input.value).toBe('compare Planning 2026.pdf '))
  await waitFor(() => expect(runtimeComposerDraft('account', chatId)?.content)
    .toBe(`compare Planning 2026.pdf \n\n[Notes](/files/f/${notes.id}) [Planning 2026.pdf](/files/d/${planning.id})`))
})

it('closes on Escape for that word without touching the text or sending', async () => {
  const view = renderComposer()
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  type(input, 'see @pl')
  await view.findByRole('listbox')
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() => expect(view.queryByRole('listbox')).toBeNull())
  expect(input.value).toBe('see @pl')
  // Still the same word: it stays closed, and Enter is the composer's again.
  type(input, 'see @pla')
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(view.queryByRole('listbox')).toBeNull()
  // A new @ word asks again.
  type(input, 'see @pla and @no')
  expect((await view.findAllByRole('option')).map((option) => option.textContent)).toEqual(['NotesMy files'])
})

it('closes when the word ends or nothing matches, and ignores an @ inside a word', async () => {
  const view = renderComposer()
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  type(input, '@pl')
  await view.findByRole('listbox')
  type(input, '@pl ')
  await waitFor(() => expect(view.queryByRole('listbox')).toBeNull())
  type(input, '@zzz')
  await waitFor(() => expect(api.searchFiles).toHaveBeenLastCalledWith('zzz', 8, expect.anything()))
  expect(view.queryByRole('listbox')).toBeNull()

  api.searchFiles.mockClear()
  type(input, 'mail a@b')
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(api.searchFiles).not.toHaveBeenCalled()
  expect(view.queryByRole('listbox')).toBeNull()
})

it('leaves @ as text where the message cannot mention Files items', async () => {
  const view = renderComposer({ canReferenceFiles: false })
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  type(input, '@pl')
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(api.searchFiles).not.toHaveBeenCalled()
  expect(view.queryByRole('listbox')).toBeNull()
  expect(input.getAttribute('aria-controls')).toBeNull()
})
