import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerChat, ServerFolder } from '../../../types'

const mocks = vi.hoisted(() => ({
  cachedChats: vi.fn(),
  getValue: vi.fn(),
  preferences: {
    synchronizedOwnerNamespace: null as string | null,
    favoriteModelIds: [] as string[],
    defaultModelId: null as string | null,
    resetSynchronizedPreferences: vi.fn(async () => undefined),
    activateAgentNamespace: vi.fn(async () => undefined),
  },
}))

vi.mock('../../../data/database', () => ({
  cacheNamespace: (instanceUrl: string, userId: string) => `${instanceUrl}|${userId}`,
  cachedChats: mocks.cachedChats,
  completeOutboxEntity: vi.fn(async () => undefined),
  getValue: mocks.getValue,
  pruneCachedChatScope: vi.fn(async () => undefined),
}))
vi.mock('../../../data/writeBehind', () => ({ enqueueCacheWrite: vi.fn() }))
vi.mock('../../../data/queries', () => ({
  chatQuery: vi.fn(() => ({})),
  chatsQuery: vi.fn(() => ({})),
  deletedChatsQuery: vi.fn(() => ({})),
  foldersQuery: vi.fn(() => ({})),
  modelsQuery: vi.fn(() => ({})),
  queryKeys: { settings: (namespace: string) => ['settings', namespace] },
}))
vi.mock('../../../api/client', () => ({ isNetworkError: () => false, mobileApi: {} }))
vi.mock('../../../data/mutations', () => ({ queueOfflineMutation: vi.fn() }))
vi.mock('../../../features/chat/projection', () => ({ projectChat: vi.fn(() => []) }))
vi.mock('../../../features/chat/api', () => ({
  createFolder: vi.fn(), deleteFolder: vi.fn(), permanentlyDeleteChat: vi.fn(), restoreChat: vi.fn(),
  trashChat: vi.fn(), updateChat: vi.fn(), updateFolder: vi.fn(),
}))
vi.mock('../../../providers/realtimeStore', () => {
  const store = Object.assign(vi.fn(), { getState: () => ({ snapshots: {} }) })
  return { subscribeToChat: vi.fn(), subscribeToResponse: vi.fn(), useRealtimeStore: store }
})
vi.mock('../../../store/preferences', () => {
  const store = Object.assign(vi.fn(), { getState: () => mocks.preferences })
  return { preferencePatchForServer: vi.fn(), preferencesFromServer: vi.fn(), usePreferencesStore: store }
})
vi.mock('../../../store/session', () => ({ useSessionStore: vi.fn() }))
vi.mock('./optimisticResponses', () => ({
  acknowledgeOptimisticChatList: vi.fn(), clearPendingOptimisticResponses: vi.fn(),
  pendingOptimisticChatIds: vi.fn(() => new Set()), pendingOptimisticResponseIds: vi.fn(() => []),
  reconcileOptimisticResponses: vi.fn((_namespace, chat) => chat),
}))
vi.mock('./optimisticBranches', () => ({
  clearOptimisticBranchSelections: vi.fn(), reconcileOptimisticBranchSelection: vi.fn((_namespace, chat) => chat),
}))

import { hydrateProductionScope } from './ProductionBridge'
import { createInitialState } from '../initialState'
import { usePrototypeStore } from '../store/prototypeStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function chat(id: string, title: string): ServerChat {
  return {
    id, title, modelId: 'model-1', pinned: false, folderId: null, sortOrder: 0, temporary: false,
    activeResponseId: null, activeBranchLeafId: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  mocks.cachedChats.mockReset().mockResolvedValue([])
  mocks.getValue.mockReset().mockResolvedValue(null)
  mocks.preferences.synchronizedOwnerNamespace = null
  mocks.preferences.favoriteModelIds = []
  mocks.preferences.defaultModelId = null
  mocks.preferences.resetSynchronizedPreferences.mockClear()
  mocks.preferences.activateAgentNamespace.mockClear()
  usePrototypeStore.setState({
    ...createInitialState(),
    productionNamespace: null, productionScopeReady: false, modelCatalogReady: false, agentAvailable: false,
  })
})

describe('production scope hydration', () => {
  it('claims and clears the namespace synchronously, then publishes cached data atomically', async () => {
    const pendingChats = deferred<ServerChat[]>()
    const cachedFolder: ServerFolder = {
      id: 'folder-1', name: 'Work', pinned: false, sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.cachedChats.mockReturnValue(pendingChats.promise)
    mocks.getValue.mockImplementation(async (_namespace: string, key: string) => {
      if (key === 'folders') return [cachedFolder]
      if (key === 'model-catalog') return { agentAvailable: true, data: [] }
      return null
    })

    const hydration = hydrateProductionScope('instance|user-a')

    expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: false,
      chats: [], folders: [], models: [],
    })

    pendingChats.resolve([chat('chat-a', 'Cached chat')])
    await hydration
    expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: true,
      modelCatalogReady: true, agentAvailable: true,
    })
    expect(usePrototypeStore.getState().chats.map((item) => item.title)).toEqual(['Cached chat'])
    expect(usePrototypeStore.getState().folders.map((item) => item.name)).toEqual(['Work'])
  })

  it('ignores a stale account hydration after a newer namespace takes ownership', async () => {
    const firstChats = deferred<ServerChat[]>()
    mocks.cachedChats
      .mockReturnValueOnce(firstChats.promise)
      .mockResolvedValueOnce([chat('chat-b', 'Current account')])

    const firstHydration = hydrateProductionScope('instance|user-a')
    await hydrateProductionScope('instance|user-b')
    firstChats.resolve([chat('chat-a', 'Wrong account')])
    await firstHydration

    expect(usePrototypeStore.getState().productionNamespace).toBe('instance|user-b')
    expect(usePrototypeStore.getState().chats.map((item) => item.title)).toEqual(['Current account'])
  })

  it('marks an empty scope ready after local database failures so networking can continue', async () => {
    mocks.cachedChats.mockRejectedValue(new Error('database unavailable'))
    mocks.getValue.mockRejectedValue(new Error('database unavailable'))

    await hydrateProductionScope('instance|user-a')

    expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: true,
      modelCatalogReady: false, chats: [], folders: [], models: [],
    })
  })

  it('does not restore temporary chats from a legacy local cache', async () => {
    mocks.cachedChats.mockResolvedValue([
      chat('saved', 'Saved chat'),
      { ...chat('temporary', 'Temporary chat'), temporary: true },
    ])

    await hydrateProductionScope('instance|user-a')

    expect(usePrototypeStore.getState().chats.map((item) => item.id)).toEqual(['saved'])
  })
})
