// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FileNode } from '@pulpo/contracts'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})
const api = vi.hoisted(() => ({
  trashFileNodes: vi.fn(async (ids: string[]) => ids),
  restoreFileNodes: vi.fn(async () => []),
  updateFileNode: vi.fn(async (id: string, input: { name: string }) => ({ id, name: `${input.name} (2)` })),
}))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ user: { id: 'user' } }) }))
vi.mock('../api', async (importOriginal) => ({ ...await importOriginal<typeof import('../api')>(), ...api }))

const { useFileOperations } = await import('./use-file-operations')
const { useFileToasts } = await import('./toasts')
const { useSettings } = await import('@/stores/settings')

const node = (id: string, kind: FileNode['kind'], name: string): FileNode => ({
  id, parentId: null, kind, name, status: 'ready', mimeType: null, sizeBytes: 0, revision: 3, trashedAt: null, createdAt: '', updatedAt: '',
})
const chat = node('trip', 'chat', 'Trip')
const doc = node('notes', 'doc', 'Notes.md')
const toasts = () => useFileToasts.getState().toasts

function operations() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useFileOperations(), { wrapper }).result.current
}

beforeEach(() => {
  useFileToasts.setState({ toasts: [] })
  useSettings.setState({ trashRetention: '30d' })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('trashing from Files', () => {
  it('moves items to the trash and restores them on undo', async () => {
    const ops = operations()
    await act(() => ops.trash([chat, doc]))
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Moved 2 items to the trash', undo: expect.any(Function) })])
    await act(() => toasts()[0]!.undo!())
    expect(api.restoreFileNodes).toHaveBeenCalledWith(['trip', 'notes'])
  })

  it('says chats deleted right away are gone, offering undo only for the rest', async () => {
    useSettings.setState({ trashRetention: 'instant' })
    const ops = operations()
    await act(() => ops.trash([chat]))
    expect(toasts()).toEqual([expect.objectContaining({ message: 'Deleted "Trip"' })])
    expect(toasts()[0]!.undo).toBeUndefined()

    await act(() => ops.trash([chat, doc]))
    expect(toasts()[1]).toMatchObject({ message: 'Deleted 2 items', undo: expect.any(Function) })
    await act(() => toasts()[1]!.undo!())
    expect(api.restoreFileNodes).toHaveBeenCalledWith(['notes'])
  })
})

describe('renaming in Files', () => {
  it('renames without a toast, as the sidebar does', async () => {
    const ops = operations()
    expect(await act(() => ops.rename(doc, 'Plans.md'))).toBe(true)
    expect(api.updateFileNode).toHaveBeenCalledWith('notes', { name: 'Plans.md', expectedRevision: 3 })
    expect(toasts()).toEqual([])
  })

  it('reports a failed rename and keeps the editor open', async () => {
    api.updateFileNode.mockRejectedValueOnce(new Error('offline'))
    const ops = operations()
    expect(await act(() => ops.rename(doc, 'Plans.md'))).toBe(false)
    expect(toasts()).toEqual([expect.objectContaining({ tone: 'error' })])
  })
})
