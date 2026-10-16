// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { FileChangeConflictBody, FileChangeSummary, FileChangesResponse } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { FileChangesBar } from './FileChangesBar'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
const api = vi.hoisted(() => ({ fetchFileChanges: vi.fn(), updateFileChanges: vi.fn(), resolveFileChange: vi.fn() }))
vi.mock('./api', async (actual) => ({ ...await actual<object>(), ...api }))

function change(overrides: Partial<FileChangeSummary>): FileChangeSummary {
  return {
    id: 'c1', nodeId: 'n1', name: 'Plan.md', nodeKind: 'doc', mimeType: 'text/markdown', kind: 'update',
    mode: 'write', status: 'applied', available: true, ...overrides,
  }
}

/** The server answers an action with the new state, which later reads return too. */
function answers(mock: ReturnType<typeof vi.fn>, next: FileChangesResponse) {
  mock.mockImplementation(async () => {
    api.fetchFileChanges.mockResolvedValue(next)
    return next
  })
}

function renderBar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TooltipProvider>
          <FileChangesBar responseId="resp-1" />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => useAuth.setState({ user: { id: 'user' } } as never))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('reply Files changes', () => {
  it('lists Write-mode changes and undoes them together', async () => {
    const applied: FileChangesResponse = {
      changes: [
        change({}),
        change({ id: 'c2', nodeId: 'n2', name: 'Drafts', nodeKind: 'folder', mimeType: null, kind: 'create' }),
        change({ id: 'c3', nodeId: 'n3', name: 'Old.md', kind: 'move', fromPath: 'Notes/Old.md', toPath: 'Archive/Old.md' }),
      ],
      canUndo: true,
      canRedo: false,
    }
    api.fetchFileChanges.mockResolvedValue(applied)
    answers(api.updateFileChanges, {
      ...applied,
      changes: applied.changes.map((item) => ({ ...item, status: 'undone' })),
      canUndo: false,
      canRedo: true,
    })
    renderBar()

    expect(await screen.findByText('Changed 3 items')).toBeTruthy()
    expect(screen.getByText('edited')).toBeTruthy()
    expect(screen.getByText('new folder')).toBeTruthy()
    expect(screen.getByText('moved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Accept all/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))

    await screen.findByText('Undid changes to 3 items')
    expect(api.updateFileChanges).toHaveBeenCalledWith('resp-1', 'undo')
    expect(screen.getByRole('button', { name: /Redo/ })).toBeTruthy()
  })

  it('offers accepting and rejecting suggestions, all at once or one by one', async () => {
    const pending: FileChangesResponse = {
      changes: [
        change({ mode: 'suggest', status: 'pending', pendingSuggestions: 3 }),
        change({ id: 'c2', nodeId: 'n2', name: 'Budget.xlsx', nodeKind: 'blob', mimeType: null, mode: 'suggest', status: 'pending' }),
      ],
      canUndo: false,
      canRedo: false,
    }
    api.fetchFileChanges.mockResolvedValue(pending)
    answers(api.resolveFileChange, { ...pending, changes: [pending.changes[0]!, { ...pending.changes[1]!, status: 'rejected' }] })
    answers(api.updateFileChanges, { ...pending, changes: pending.changes.map((item) => ({ ...item, status: 'accepted', pendingSuggestions: 0 })) })
    renderBar()

    expect(await screen.findByText('2 suggested changes to review')).toBeTruthy()
    expect(screen.getByText('3 suggestions')).toBeTruthy()
    expect(screen.getByText('new version')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reject the change to Budget.xlsx' }))
    await screen.findByText('rejected')
    expect(api.resolveFileChange).toHaveBeenCalledWith('c2', 'reject')
    expect(screen.getByText('1 suggested change to review')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Accept all/ }))
    await screen.findByText('Reviewed 2 suggested changes')
    expect(api.updateFileChanges).toHaveBeenCalledWith('resp-1', 'accept')
  })

  it('explains a refused undo with what changed since', async () => {
    api.fetchFileChanges.mockResolvedValue({ changes: [change({})], canUndo: true, canRedo: false })
    const body: FileChangeConflictBody = { error: {
      code: 'file_changes_conflict',
      message: 'Items changed since this reply',
      conflicts: [{ changeId: 'c1', nodeId: 'n1', name: 'Plan.md', kind: 'update', reason: 'edited', expected: '# Plan\n\nShip it', current: '# Plan\n\nShip it soon' }],
    } }
    api.updateFileChanges.mockRejectedValue(new ApiError(409, 'file_changes_conflict', body.error.message, body))
    renderBar()

    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("These changes can't be undone")).toBeTruthy()
    expect(within(dialog).getByText("Edited since the agent's reply")).toBeTruthy()
    expect(within(dialog).getByText('Ship it')).toBeTruthy()
    expect(within(dialog).getByText('Ship it soon')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows nothing when the reply changed nothing it can list', async () => {
    api.fetchFileChanges.mockResolvedValue({ changes: [], canUndo: false, canRedo: false })
    const view = renderBar()
    await waitFor(() => expect(api.fetchFileChanges).toHaveBeenCalled())
    expect(view.container.textContent).toBe('')
  })
})
