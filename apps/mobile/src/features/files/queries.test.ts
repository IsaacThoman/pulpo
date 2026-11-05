// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchFileNode: vi.fn(),
  cachedNode: vi.fn(),
  cacheNode: vi.fn(async () => undefined),
  forgetStaleDocCopies: vi.fn(async () => undefined),
}))

vi.mock('../../api/client', () => ({ isNetworkError: (error: unknown) => (error as { network?: boolean } | null)?.network === true }))
vi.mock('./api', () => ({ fetchFileNode: mocks.fetchFileNode, fetchFileChanges: vi.fn(), fetchFolder: vi.fn() }))
vi.mock('./cache', () => ({ cachedNode: mocks.cachedNode, cacheNode: mocks.cacheNode, forgetStaleDocCopies: mocks.forgetStaleDocCopies, cachedListing: vi.fn(), cacheListing: vi.fn() }))

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
    // An item that is no longer a document has its stale copy removed.
    expect(mocks.forgetStaleDocCopies).toHaveBeenCalledWith(NAMESPACE, [node])
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

describe('Files query keys', () => {
  it('keeps every key under the account prefix that refreshes and realtime invalidate', async () => {
    const { filesQueryKeys } = await import('./queries')
    const prefix = filesQueryKeys.all('ns')
    const keys = [
      filesQueryKeys.folder('ns', null),
      filesQueryKeys.node('ns', 'ID'),
      filesQueryKeys.changes('ns'),
      filesQueryKeys.responseChanges('ns', 'reply'),
      filesQueryKeys.changeText('ns', 'reply', 'change'),
    ]
    for (const key of keys) expect(key.slice(0, prefix.length)).toEqual([...prefix])
    // A reply's change list refetches its changes' text with it.
    const changes = filesQueryKeys.responseChanges('ns', 'reply')
    expect(filesQueryKeys.changeText('ns', 'reply', 'change').slice(0, changes.length)).toEqual([...changes])
  })
})
