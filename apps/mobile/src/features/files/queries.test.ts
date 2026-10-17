// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchFileNode: vi.fn(),
  cachedNode: vi.fn(),
  cacheNode: vi.fn(async () => undefined),
}))

vi.mock('../../api/client', () => ({ isNetworkError: (error: unknown) => (error as { network?: boolean } | null)?.network === true }))
vi.mock('./api', () => ({ fetchFileNode: mocks.fetchFileNode, fetchFileChanges: vi.fn(), fetchFolder: vi.fn(), fetchSidebar: vi.fn() }))
vi.mock('./cache', () => ({ cachedNode: mocks.cachedNode, cacheNode: mocks.cacheNode, cachedListing: vi.fn(), cacheListing: vi.fn() }))

const { lookUpFileNode } = await import('./queries')

const NAMESPACE = 'https://pulpo.test|a'
const node = { id: 'report', kind: 'blob', name: 'Report.pdf' }

beforeEach(() => {
  mocks.fetchFileNode.mockReset()
  mocks.cachedNode.mockReset().mockResolvedValue(null)
  mocks.cacheNode.mockClear()
})

describe('looking up a Files item', () => {
  it('keeps what the server says for later', async () => {
    mocks.fetchFileNode.mockResolvedValue({ node, ancestors: [] })
    await expect(lookUpFileNode(NAMESPACE, 'report')).resolves.toEqual({ node, ancestors: [] })
    expect(mocks.cacheNode).toHaveBeenCalledWith(NAMESPACE, { node, ancestors: [] })
  })

  it('answers offline with the item as last seen on the device', async () => {
    mocks.fetchFileNode.mockRejectedValue({ network: true })
    mocks.cachedNode.mockResolvedValue({ node, ancestors: [] })
    await expect(lookUpFileNode(NAMESPACE, 'report')).resolves.toEqual({ node, ancestors: [], offline: true })
  })

  it('fails at once offline for an item never seen, rather than waiting for the connection', async () => {
    mocks.fetchFileNode.mockRejectedValue({ network: true })
    await expect(lookUpFileNode(NAMESPACE, 'report')).rejects.toEqual({ network: true })
    expect(mocks.fetchFileNode).toHaveBeenCalledTimes(1)
  })
})
