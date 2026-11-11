// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/stores/auth'
import { FileScopeChip } from './FileScope'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const api = vi.hoisted(() => ({ fetchFileNode: vi.fn() }))
vi.mock('./api', async (actual) => ({ ...await actual<object>(), fetchFileNode: api.fetchFileNode }))

const plan: FileNode = {
  id: '00000000-0000-4000-8000-0000000000a1', parentId: null, kind: 'doc', name: 'Plan.md', status: 'ready',
  mimeType: 'text/markdown', sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}

function renderChip(props: { onRemove?: () => void } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <FileScopeChip id={plan.id} {...props} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'user' } } as never)
  api.fetchFileNode.mockResolvedValue({ node: plan, ancestors: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Files item chips', () => {
  it('names the item and removes it', async () => {
    const onRemove = vi.fn()
    renderChip({ onRemove })
    expect(await screen.findByRole('button', { name: 'Plan.md' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Plan.md' }))
    expect(onRemove).toHaveBeenCalledOnce()
    // Modes are chosen for the whole chat in the Pulpo Agent menu, not per item.
    expect(screen.queryByRole('button', { name: /Agent access/ })).toBeNull()
  })

  it('strikes out an item that is no longer available', async () => {
    api.fetchFileNode.mockResolvedValue({ node: { ...plan, trashedAt: '2026-11-01T00:00:00.000Z' }, ancestors: [] })
    renderChip()
    const name = await screen.findByRole('button', { name: 'Plan.md' })
    await vi.waitFor(() => expect((name as HTMLButtonElement).disabled).toBe(true))
  })
})
