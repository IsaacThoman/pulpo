// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import { FileReferenceCard } from './FileReferenceCard'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
const api = vi.hoisted(() => ({ fetchFileNode: vi.fn() }))
vi.mock('./api', async (actual) => ({ ...await actual<object>(), fetchFileNode: api.fetchFileNode }))

const projects: FileNode = {
  id: '00000000-0000-4000-8000-0000000000f1', parentId: null, kind: 'folder', name: 'Projects', status: 'ready',
  mimeType: null, sizeBytes: 0, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}
const plan: FileNode = { ...projects, id: '00000000-0000-4000-8000-0000000000a1', parentId: projects.id, kind: 'doc', name: 'Launch plan.md', mimeType: 'text/markdown' }
const reference = { id: plan.id, name: 'Plan (old name).md', folder: false }

function renderCard(props: { onRemove?: () => void; variant?: 'composer' | 'message' } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><FileReferenceCard reference={reference} variant={props.variant ?? 'composer'} onRemove={props.onRemove} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { useAuth.setState({ user: { id: 'user' } } as never) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows the live item with where it is in Files, and removes it', async () => {
  api.fetchFileNode.mockResolvedValue({ node: plan, ancestors: [projects] })
  const onRemove = vi.fn()
  renderCard({ onRemove })
  expect(await screen.findByRole('button', { name: 'Open Launch plan.md in Files' })).toBeTruthy()
  expect(screen.getByText('In Files · Projects')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Launch plan.md' }))
  expect(onRemove).toHaveBeenCalledOnce()
})

it('says when the item is no longer in Files', async () => {
  api.fetchFileNode.mockRejectedValue(new Error('Not found'))
  renderCard({ variant: 'message' })
  const card = await screen.findByRole('button', { name: 'Plan (old name).md, no longer in Files' })
  expect((card as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('No longer in Files')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
})
