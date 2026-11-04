// @vitest-environment node
import type { FileListing, FileNode, SidebarState } from '@pulpo/contracts'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(async (_path: string, _options?: unknown): Promise<unknown> => ({})),
  refreshFiles: vi.fn(async () => undefined),
  setPreference: vi.fn(async () => undefined),
}))

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false, apiRequest: mocks.apiRequest }))
vi.mock('./operations', () => ({ refreshFiles: mocks.refreshFiles }))
vi.mock('./queries', () => ({ filesQueryKeys: { all: (namespace: string) => ['files', namespace] } }))

const { applyItemAppearance, restyleCachedItems } = await import('./itemAppearance')
const { configureProductionActions } = await import('../../mockup5/src/production/productionActions')
const { trashFolderNode } = await import('../trash/folder')

const NAMESPACE = 'https://pulpo.test|a'
const node = (patch: Partial<FileNode> = {}): FileNode => ({
  id: 'f1', parentId: null, kind: 'folder', name: 'Projects', status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '', updatedAt: '', systemRole: null, color: null, icon: null, ...patch,
})
const shortcut = node({ id: 's1', kind: 'shortcut', name: 'Projects', target: { id: 'f1', kind: 'folder', name: 'Projects', mimeType: null, systemRole: null, available: true } })

let client: QueryClient
beforeEach(() => {
  client = new QueryClient()
  mocks.apiRequest.mockClear()
  mocks.refreshFiles.mockClear()
  mocks.setPreference.mockClear()
  configureProductionActions({ setPreference: mocks.setPreference })
})

describe('changing an item’s color and icon', () => {
  it('shows the change at once in Files listings, looked-up items, and the drawer, shortcuts included', () => {
    client.setQueryData<FileListing>(['files', NAMESPACE, 'folder', 'root'], { folder: null, ancestors: [], children: [node(), node({ id: 'f2' }), shortcut] })
    client.setQueryData(['files', NAMESPACE, 'folder', 'f1'], { folder: node(), ancestors: [], children: [] })
    client.setQueryData(['files', NAMESPACE, 'node', 'f1'], { node: node(), ancestors: [] })
    client.setQueryData(['files', NAMESPACE, 'sidebar', 'items', 'chats'], [node()])
    client.setQueryData<Partial<SidebarState>>(['files', NAMESPACE, 'sidebar', 'state'], { pinnedItems: [shortcut] })
    client.setQueryData(['files', 'other-account', 'folder', 'root'], { folder: null, ancestors: [], children: [node()] })

    restyleCachedItems(client, NAMESPACE, ['f1'], { color: 'teal' })

    const root = client.getQueryData<FileListing>(['files', NAMESPACE, 'folder', 'root'])!
    expect(root.children.map((item) => item.color ?? item.target?.color ?? null)).toEqual(['teal', null, 'teal'])
    expect(client.getQueryData<FileListing>(['files', NAMESPACE, 'folder', 'f1'])!.folder?.color).toBe('teal')
    expect(client.getQueryData<{ node: FileNode }>(['files', NAMESPACE, 'node', 'f1'])!.node.color).toBe('teal')
    expect(client.getQueryData<FileNode[]>(['files', NAMESPACE, 'sidebar', 'items', 'chats'])![0]!.color).toBe('teal')
    expect(client.getQueryData<SidebarState>(['files', NAMESPACE, 'sidebar', 'state'])!.pinnedItems![0]!.target?.color).toBe('teal')
    expect(client.getQueryData<FileListing>(['files', 'other-account', 'folder', 'root'])!.children[0]!.color).toBeNull()
  })

  it('sends each item’s change through the sidebar route, as the web does, then refreshes', async () => {
    const show = vi.fn()
    await applyItemAppearance(client, NAMESPACE, show, [node(), node({ id: 'd1', kind: 'doc' })], { icon: 'rocket' })
    expect(mocks.apiRequest.mock.calls).toEqual([
      ['/api/sidebar/items/f1', { method: 'PATCH', body: { icon: 'rocket' } }],
      ['/api/sidebar/items/d1', { method: 'PATCH', body: { icon: 'rocket' } }],
    ])
    expect(mocks.refreshFiles).toHaveBeenCalledWith(client, NAMESPACE)
    expect(show).not.toHaveBeenCalled()
  })

  it('saves quick successive choices for an item in order and refreshes once the last is saved', async () => {
    let finishFirst!: () => void
    mocks.apiRequest.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = () => resolve({}) }))
    const first = applyItemAppearance(client, NAMESPACE, vi.fn(), [node()], { color: 'red' })
    const second = applyItemAppearance(client, NAMESPACE, vi.fn(), [node()], { color: 'blue' })
    await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1))
    // The second choice waits for the first save rather than racing it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1)
    finishFirst()
    await Promise.all([first, second])
    expect(mocks.apiRequest.mock.calls.map(([, options]) => (options as { body: unknown }).body)).toEqual([{ color: 'red' }, { color: 'blue' }])
    expect(mocks.refreshFiles).toHaveBeenCalledTimes(1)
  })

  it('puts back a refused item in a bulk change once the other saves have finished', async () => {
    let finishOther!: () => void
    mocks.apiRequest
      .mockRejectedValueOnce(new Error('Nope'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishOther = () => resolve({}) }))
    const show = vi.fn()
    const done = applyItemAppearance(client, NAMESPACE, show, [node(), node({ id: 'd1', kind: 'doc' })], { color: 'red' })
    await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(2))
    expect(mocks.refreshFiles).not.toHaveBeenCalled()
    finishOther()
    await done
    expect(show).toHaveBeenCalledWith({ message: 'Nope', tone: 'error' })
    expect(mocks.refreshFiles).toHaveBeenCalledTimes(1)
  })

  it('keeps the trash’s color as a setting', async () => {
    await applyItemAppearance(client, NAMESPACE, vi.fn(), [trashFolderNode()], { color: 'purple' })
    expect(mocks.setPreference).toHaveBeenCalledWith('trashColor', 'purple')
    expect(mocks.apiRequest).not.toHaveBeenCalled()
  })

  it('reports a refused change in a toast and refetches to put it back', async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error('Nope'))
    const show = vi.fn()
    await applyItemAppearance(client, NAMESPACE, show, [node()], { color: 'red' })
    expect(show).toHaveBeenCalledWith({ message: 'Nope', tone: 'error' })
    expect(mocks.refreshFiles).toHaveBeenCalled()
  })
})
