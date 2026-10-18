// @vitest-environment node
import type { SidebarState } from '@pulpo/contracts'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchSidebarState: vi.fn(),
  fetchSidebarItems: vi.fn(),
  kept: new Map<string, unknown>(),
}))

vi.mock('../../api/client', () => ({ isNetworkError: (error: unknown) => (error as { network?: boolean } | null)?.network === true }))
vi.mock('../../data/database', () => ({
  getValue: async (_namespace: string, key: string) => mocks.kept.get(key) ?? null,
  setValue: async (_namespace: string, key: string, value: unknown) => { mocks.kept.set(key, value) },
}))
vi.mock('./api', () => ({ fetchSidebarState: mocks.fetchSidebarState, fetchSidebarItems: mocks.fetchSidebarItems }))

const { keepSidebarOnDevice, sidebarItemsQuery, sidebarKeys, sidebarStateQuery, sidebarUnavailable } = await import('./queries')

const NAMESPACE = 'https://pulpo.test|a'
const state = { chatsFolderId: 'chats', archiveFolderId: 'archive', folders: [], pinnedItems: [] } satisfies SidebarState
let client: QueryClient

beforeEach(() => {
  mocks.kept.clear()
  mocks.fetchSidebarState.mockReset()
  mocks.fetchSidebarItems.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('the sidebar queries', () => {
  it('keep what the server says on the device, and answer from it offline', async () => {
    mocks.fetchSidebarState.mockResolvedValue(state)
    await expect(client.fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toEqual(state)
    await vi.waitFor(() => expect(mocks.kept.get('sidebar:state')).toEqual({ value: state }))

    mocks.fetchSidebarState.mockRejectedValue({ network: true })
    await expect(new QueryClient().fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toEqual(state)
  })

  it('remember a server without the sidebar, offline too', async () => {
    mocks.fetchSidebarState.mockResolvedValue(null)
    await expect(client.fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toBeNull()
    mocks.fetchSidebarState.mockRejectedValue({ network: true })
    await vi.waitFor(() => expect(mocks.kept.has('sidebar:state')).toBe(true))
    await expect(new QueryClient().fetchQuery(sidebarStateQuery(NAMESPACE))).resolves.toBeNull()
  })

  it('fail offline when the device has nothing yet, and on other errors', async () => {
    mocks.fetchSidebarItems.mockRejectedValue({ network: true })
    await expect(client.fetchQuery(sidebarItemsQuery(NAMESPACE, 'work'))).rejects.toEqual({ network: true })
    mocks.kept.set('sidebar:items:work', { value: [] })
    mocks.fetchSidebarItems.mockRejectedValue(new Error('Forbidden'))
    await expect(new QueryClient().fetchQuery(sidebarItemsQuery(NAMESPACE, 'work'))).rejects.toThrow('Forbidden')
  })

  it('tell a listing that is missing offline from one that was refused, and from one still loading', () => {
    expect(sidebarUnavailable({ data: undefined, isError: false, fetchStatus: 'paused' })).toBe('offline')
    expect(sidebarUnavailable({ data: undefined, isError: true, fetchStatus: 'idle' })).toBe('failed')
    expect(sidebarUnavailable({ data: undefined, isError: false, fetchStatus: 'fetching' })).toBeNull()
    expect(sidebarUnavailable({ data: [], isError: true, fetchStatus: 'paused' })).toBeNull()
  })

  it('keep changes made offline for the next launch', async () => {
    client.setQueryData(sidebarKeys.state(NAMESPACE), state)
    client.setQueryData(sidebarKeys.items(NAMESPACE, 'work'), [{ id: 'new' }])
    await keepSidebarOnDevice(client, NAMESPACE)
    expect(mocks.kept.get('sidebar:state')).toEqual({ value: state })
    expect(mocks.kept.get('sidebar:items:work')).toEqual({ value: [{ id: 'new' }] })
  })
})
