// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { FileSuggestionBanner } from './FileSuggestion'

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

function renderBanner(node: FileNode = draft) {
  const onRejected = vi.fn()
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <FileSuggestionBanner node={node} onRejected={onRejected} />
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

  it('shows nothing for items the owner already has', () => {
    const { view } = renderBanner({ ...draft, suggestion: null })
    expect(view.container.textContent).toBe('')
  })
})
