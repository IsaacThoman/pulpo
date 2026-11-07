// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelTabs } from './PanelTabs'
import { useSidePanel, type PanelContent } from './store'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined }) })
})

vi.mock('@/stores/auth', () => ({ useAuth: (selector: (state: unknown) => unknown) => selector({ user: { id: 'owner' } }) }))
vi.mock('@/features/files/api', async (original) => ({
  ...await original<typeof import('@/features/files/api')>(),
  fetchFileNode: async (id: string) => ({ node: { id, name: names[id], kind: id === folder ? 'folder' : 'blob', mimeType: null, parentId: null }, ancestors: [] }),
}))
vi.mock('@/components/chat/attachment-actions', () => ({
  attachmentQueryKey: (userId: string, id: string) => ['attachment', userId, id],
  fetchAttachment: async (id: string) => ({ id, name: 'photo.png', mimeType: 'image/png' }),
}))

const a = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const b = '1b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c'
const folder = '2b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5d'
const names: Record<string, string> = { [a]: 'Budget.xlsx', [b]: 'Notes.txt', [folder]: 'Projects' }

function show(tabs: PanelContent[], content = tabs[0]!) {
  useSidePanel.setState({ tabs, content, lastContent: content })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><PanelTabs /></QueryClientProvider>)
}

beforeEach(() => useSidePanel.setState({ tabs: [], content: null, lastContent: null }))
afterEach(cleanup)

describe('side panel tabs', () => {
  it('stays out of the way with a single tab', () => {
    show([{ kind: 'file', id: a }])
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('names each tab after what it shows', async () => {
    show([{ kind: 'file', id: a }, { kind: 'folder', id: folder }, { kind: 'folder', id: null }, { kind: 'attachment', id: b }, { kind: 'folder', id: 'trash' }])
    await screen.findByRole('tab', { name: /Budget.xlsx/ })
    await screen.findByRole('tab', { name: /Projects/ })
    await screen.findByRole('tab', { name: /photo.png/ })
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('title'))).toEqual(['Budget.xlsx', 'Projects', 'My files', 'photo.png', 'Trash'])
    expect(screen.getByRole('tab', { name: /Budget.xlsx/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('switches, closes, and middle-click closes tabs', async () => {
    show([{ kind: 'file', id: a }, { kind: 'file', id: b }, { kind: 'folder', id: null }])
    fireEvent.click(await screen.findByRole('tab', { name: /Notes.txt/ }))
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: b })
    fireEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1]!)
    expect(useSidePanel.getState().tabs).toEqual([{ kind: 'file', id: a }, { kind: 'folder', id: null }])
    expect(useSidePanel.getState().content).toEqual({ kind: 'folder', id: null })
    fireEvent(screen.getByRole('tab', { name: /Budget.xlsx/ }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(useSidePanel.getState().tabs).toEqual([{ kind: 'folder', id: null }])
    // One tab left: the strip gives the room back.
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('moves between tabs with the arrow keys', async () => {
    show([{ kind: 'file', id: a }, { kind: 'file', id: b }])
    const first = await screen.findByRole('tab', { name: /Budget.xlsx/ })
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: b })
    fireEvent.keyDown(screen.getByRole('tab', { name: /Notes.txt/ }), { key: 'ArrowRight' })
    expect(useSidePanel.getState().content).toEqual({ kind: 'file', id: a })
  })
})
