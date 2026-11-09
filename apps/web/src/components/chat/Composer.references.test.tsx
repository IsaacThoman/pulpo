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
const api = vi.hoisted(() => ({ fetchFileNode: vi.fn() }))
vi.mock('@/features/files/api', async (actual) => ({ ...await actual<object>(), fetchFileNode: api.fetchFileNode }))

const { Composer } = await import('./Composer')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft, runtimeComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { addToChat, useChatTarget, usePendingReferences } = await import('@/features/side-panel/agent')
const { queryClient } = await import('@/lib/query-client')

const chatId = '11111111-1111-4111-8111-111111111111'
const plan: FileNode = {
  id: '00000000-0000-4000-8000-0000000000a1', parentId: null, kind: 'doc', name: 'Plan.md', status: 'ready',
  mimeType: 'text/markdown', sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}
const notes: FileNode = { ...plan, id: '00000000-0000-4000-8000-0000000000a2', kind: 'folder', name: 'Notes', mimeType: null }
const nodes = new Map([[plan.id, plan], [notes.id, notes]])

beforeEach(() => {
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, filesEnabled: true })
  useSettings.setState({ composerSyncEnabled: false, agentModes: { model: false } })
  useUploadOutbox.setState({ uploads: {}, submissions: [] })
  usePendingReferences.setState({ target: null, ids: [] })
  queryClient.clear()
  clearRuntimeComposerDrafts('account')
  api.fetchFileNode.mockImplementation(async (id: string) => ({ node: nodes.get(id), ancestors: [] }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderComposer() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><TooltipProvider><Composer chatId={chatId} modelId="model" syncEnabled={false} canReferenceFiles /></TooltipProvider></MemoryRouter>
    </QueryClientProvider>,
  )
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
