// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { FileSuggestionBanner } from './FileSuggestion'
import { suggestionRoot } from './use-file-suggestion'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
const api = vi.hoisted(() => ({ resolveFileSuggestion: vi.fn() }))
vi.mock('./api', async (actual) => ({ ...await actual<object>(), ...api }))

const draft: FileNode = {
  id: '00000000-0000-4000-8000-0000000000a1', parentId: null, kind: 'blob', name: 'draft.txt', status: 'ready',
  mimeType: 'text/plain', sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
  suggestion: { changeId: '00000000-0000-4000-8000-0000000000c1' },
}

const plan: FileNode = { ...draft, id: '00000000-0000-4000-8000-0000000000f1', kind: 'folder', name: 'Plan', mimeType: null }
const notes: FileNode = { ...draft, id: '00000000-0000-4000-8000-0000000000a2', parentId: plan.id, name: 'notes.md' }
const projects: FileNode = { ...plan, id: '00000000-0000-4000-8000-0000000000f0', name: 'Projects', suggestion: null }

function renderBanner(node: FileNode = draft, ancestors: FileNode[] = []) {
  const onRejected = vi.fn()
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <FileSuggestionBanner node={node} ancestors={ancestors} onRejected={onRejected} />
    </QueryClientProvider>,
  )
  return { onRejected, view }
}

beforeEach(() => useAuth.setState({ user: { id: 'user' } } as never))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('suggested Files items', () => {
  it('keeps an accepted item where it is', async () => {
    api.resolveFileSuggestion.mockResolvedValue({ ...draft, suggestion: null })
    const { onRejected } = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(api.resolveFileSuggestion).toHaveBeenCalledWith(draft.id, 'accept'))
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('leaves the view of a rejected item, which no longer exists', async () => {
    api.resolveFileSuggestion.mockResolvedValue(null)
    const { onRejected } = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(onRejected).toHaveBeenCalled())
    expect(api.resolveFileSuggestion).toHaveBeenCalledWith(draft.id, 'reject')
  })

  it('reports a failure and stays', async () => {
    api.resolveFileSuggestion.mockRejectedValue(new ApiError(404, 'not_found', 'Not found'))
    const { onRejected } = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This item no longer exists')
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('acts on the whole suggested folder from an item inside it', async () => {
    api.resolveFileSuggestion.mockResolvedValue(null)
    const { onRejected } = renderBanner(notes, [projects, plan])
    expect(screen.getByRole('status').textContent).toContain('part of the folder “Plan” an agent suggested')
    fireEvent.click(screen.getByRole('button', { name: 'Reject folder' }))
    await waitFor(() => expect(onRejected).toHaveBeenCalledWith(plan))
    expect(api.resolveFileSuggestion).toHaveBeenCalledWith(plan.id, 'reject')
  })

  it('shows nothing for items the owner already has', () => {
    const { view } = renderBanner({ ...draft, suggestion: null })
    expect(view.container.textContent).toBe('')
  })
})

describe('suggestionRoot', () => {
  it('finds the topmost folder in the same suggestion', () => {
    const inner = { ...plan, id: 'inner', parentId: plan.id, name: 'Drafts' }
    expect(suggestionRoot({ ...notes, parentId: inner.id }, [projects, plan, inner])).toBe(plan)
    expect(suggestionRoot(notes, [projects, plan])).toBe(plan)
    expect(suggestionRoot(plan, [projects])).toBe(plan)
  })

  it('stops at a folder from another suggestion', () => {
    const other = { ...plan, suggestion: { changeId: '00000000-0000-4000-8000-0000000000c9' } }
    expect(suggestionRoot(notes, [other])).toBe(notes)
  })
})
