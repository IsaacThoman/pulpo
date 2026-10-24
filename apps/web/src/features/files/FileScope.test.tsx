// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { FileAccessMode, FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/stores/auth'
import { useFilesViews } from '@/features/side-panel/agent'
import { FileScopeChip } from './FileScope'
import { useOpenFileOffer } from './open-file-offer'
import { useMainTabs } from '@/features/side-panel/main-tabs'

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

function renderChip(props: { mode?: FileAccessMode; onModeChange?: (mode: FileAccessMode) => void }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <FileScopeChip id={plan.id} onRemove={() => undefined} {...props} />
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

describe('Files scope chips', () => {
  it('shows the default mode and switches it from the chip’s menu', async () => {
    const onModeChange = vi.fn()
    renderChip({ onModeChange })
    const trigger = await screen.findByRole('button', { name: 'Agent access to Plan.md: Suggest changes' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const options = await screen.findAllByRole('menuitemradio')
    expect(options.map((option) => option.textContent)).toEqual([
      'Read onlyThe agent can look but not change anything',
      'Suggest changesDefaultYou accept or reject each change',
      'Edit directlyChanges apply right away, and you can undo them',
    ])
    expect(options[1]!.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(options[2]!)
    expect(onModeChange).toHaveBeenCalledWith('write')
  })

  it('shows the mode without a menu where the scope cannot change', async () => {
    renderChip({ mode: 'read' })
    expect(await screen.findByRole('img', { name: 'Agent access to Plan.md: Read only' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Agent access/ })).toBeNull()
  })
})

const NONE: string[] = []

function Offer({ selected = NONE }: { selected?: string[] }) {
  const offer = useOpenFileOffer(selected)
  return <output>{offer ? `${offer.id} ${offer.name}` : 'none'}</output>
}

function renderOffer(selected?: string[]) {
  return render(<QueryClientProvider client={new QueryClient()}><Offer selected={selected} /></QueryClientProvider>)
}

describe('the open file offered to the composer', () => {
  const notes: FileNode = { ...plan, id: '00000000-0000-4000-8000-0000000000b2', name: 'Notes.md' }
  beforeEach(() => {
    api.fetchFileNode.mockImplementation(async (id: string) => ({ node: id === notes.id ? notes : plan, ancestors: [] }))
    useMainTabs.setState({ userId: 'user', tabs: [{ id: 'tab', content: { kind: 'file', id: notes.id } }], activeId: 'tab' }, true)
    useFilesViews.setState({ page: null, panel: null })
  })

  it('is what the side panel shows beside the chat', async () => {
    useFilesViews.setState({ panel: { layout: 'panel', view: { kind: 'file', id: plan.id }, item: { id: plan.id } } })
    renderOffer()
    expect((await screen.findByText(`${plan.id} Plan.md`))).toBeTruthy()
  })

  it('is the active Files tab’s file without a panel', async () => {
    renderOffer()
    expect((await screen.findByText(`${notes.id} Notes.md`))).toBeTruthy()
  })

  it('is nothing once it is attached, or when the active tab is a folder', async () => {
    renderOffer([notes.id])
    expect(screen.getByText('none')).toBeTruthy()
    cleanup()
    useMainTabs.setState({ tabs: [{ id: 'tab', content: { kind: 'folder', id: null } }] })
    renderOffer()
    expect(screen.getByText('none')).toBeTruthy()
  })
})
