import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileModel, ServerChat, ServerFolder } from '../../../types'

const mocks = vi.hoisted(() => ({
  cachedChats: vi.fn(),
  getValue: vi.fn(),
  preferences: {
    synchronizedOwnerNamespace: null as string | null,
    favoriteModelIds: [] as string[],
    defaultModelId: null as string | null,
    resetSynchronizedPreferences: vi.fn(async () => undefined),
  },
}))

vi.mock('../../../data/database', () => ({
  cacheNamespace: (instanceUrl: string, userId: string) => `${instanceUrl}|${userId}`,
  cachedChats: mocks.cachedChats,
  completeOutboxEntity: vi.fn(async () => undefined),
  detachAllComposerDraftServerReferences: vi.fn(async () => undefined),
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
vi.mock('../../../features/chat/composerDrafts', () => ({
  enableMobileComposerDraftSync: vi.fn(async () => undefined),
  markMobileComposerDraftSyncEnablePending: vi.fn(async () => undefined),
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
vi.mock('./AiIconAssets', () => ({ warmModelCatalogIcons: vi.fn(async () => undefined) }))
vi.mock('./optimisticResponses', () => ({
  acknowledgeOptimisticChatList: vi.fn(), clearPendingOptimisticResponses: vi.fn(),
  pendingOptimisticChatIds: vi.fn(() => new Set()), pendingOptimisticResponseIds: vi.fn(() => []),
  reconcileOptimisticResponses: vi.fn((_namespace, chat) => chat),
}))
vi.mock('./optimisticBranches', () => ({
  clearOptimisticBranchSelections: vi.fn(), reconcileOptimisticBranchSelection: vi.fn((_namespace, chat) => chat),
}))

import { hydrateProductionChatPreview, hydrateProductionScope } from './ProductionBridge'
import { mergeServerFolders } from './folderMetadata'
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

function model(id: string): MobileModel {
  return {
    id, name: `Model ${id}`, description: 'Cached model', executionMode: 'stream',
    maxOutputTokens: 8_000, agentEnabled: true, tags: [], logo: 'openai',
    iconLight: null, iconDark: null, provider: { id: 'provider-1', name: 'Provider' },
    lab: { id: 'lab-1', name: 'Lab', logo: 'openai' }, presets: [],
  }
}

beforeEach(() => {
  mocks.cachedChats.mockReset().mockResolvedValue([])
  mocks.getValue.mockReset().mockResolvedValue(null)
  mocks.preferences.synchronizedOwnerNamespace = null
  mocks.preferences.favoriteModelIds = []
  mocks.preferences.defaultModelId = null
  mocks.preferences.resetSynchronizedPreferences.mockClear()
  usePrototypeStore.setState({
    ...createInitialState(),
    productionNamespace: null, productionScopeReady: false, modelPickerScopeReady: false,
    modelCatalogReady: false, agentAvailable: false,
  })
})

describe('production scope hydration', () => {
  it('preserves local folder expansion when server metadata refreshes', () => {
    const folder: ServerFolder = {
      id: 'folder-1', name: 'Renamed', pinned: true, sortOrder: 2,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    }

    expect(mergeServerFolders([folder], [{ id: folder.id, name: 'Old name', expanded: false }])).toEqual([
      { id: folder.id, name: 'Renamed', expanded: false },
    ])
  })

  it('publishes the cached picker before unrelated chat hydration completes', async () => {
    const pendingChats = deferred<ServerChat[]>()
    const cachedFolder: ServerFolder = {
      id: 'folder-1', name: 'Work', pinned: false, sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.cachedChats.mockReturnValue(pendingChats.promise)
    mocks.getValue.mockImplementation(async (_namespace: string, key: string) => {
      if (key === 'folders') return [cachedFolder]
      if (key === 'model-catalog') return { agentAvailable: true, data: [model('cached')] }
      return null
    })

    const hydration = hydrateProductionScope('instance|user-a')

    expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: false,
      chats: [], folders: [], models: [],
    })

    await vi.waitFor(() => expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: false,
      modelPickerScopeReady: true, modelCatalogReady: true,
    }))
    expect(usePrototypeStore.getState().models.map((item) => item.id)).toEqual(['cached'])

    pendingChats.resolve([chat('chat-a', 'Cached chat')])
    await hydration
    expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: true,
      modelPickerScopeReady: true, modelCatalogReady: true, agentAvailable: true,
    })
    expect(usePrototypeStore.getState().chats.map((item) => item.title)).toEqual(['Cached chat'])
    expect(usePrototypeStore.getState().folders.map((item) => item.name)).toEqual(['Work'])
  })

  it('ignores a stale account hydration after a newer namespace takes ownership', async () => {
    const firstChats = deferred<ServerChat[]>()
    const firstCatalog = deferred<{ agentAvailable: boolean; data: MobileModel[] }>()
    mocks.cachedChats
      .mockReturnValueOnce(firstChats.promise)
      .mockResolvedValueOnce([chat('chat-b', 'Current account')])
    mocks.getValue.mockImplementation(async (namespace: string, key: string) => {
      if (key !== 'model-catalog') return null
      if (namespace === 'instance|user-a') return firstCatalog.promise
      return { agentAvailable: true, data: [model('model-b')] }
    })

    const firstHydration = hydrateProductionScope('instance|user-a')
    await hydrateProductionScope('instance|user-b')
    firstChats.resolve([chat('chat-a', 'Wrong account')])
    firstCatalog.resolve({ agentAvailable: true, data: [model('model-a')] })
    await firstHydration

    expect(usePrototypeStore.getState().productionNamespace).toBe('instance|user-b')
    expect(usePrototypeStore.getState().chats.map((item) => item.title)).toEqual(['Current account'])
    expect(usePrototypeStore.getState().models.map((item) => item.id)).toEqual(['model-b'])
  })

  it('marks an empty scope ready after local database failures so networking can continue', async () => {
    mocks.cachedChats.mockRejectedValue(new Error('database unavailable'))
    mocks.getValue.mockRejectedValue(new Error('database unavailable'))

    await hydrateProductionScope('instance|user-a')

    expect(usePrototypeStore.getState()).toMatchObject({
      productionNamespace: 'instance|user-a', productionScopeReady: true,
      modelPickerScopeReady: true, modelCatalogReady: false, chats: [], folders: [], models: [],
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

describe('chat preview hydration', () => {
  it('fetches an uncached transcript without selecting the chat', async () => {
    const summary = chat('chat-a', 'Preview me')
    usePrototypeStore.setState({
      productionNamespace: 'instance|user-a',
      chats: [{
        id: summary.id, title: summary.title, modelId: summary.modelId,
        createdAt: Date.parse(summary.createdAt), updatedAt: Date.parse(summary.updatedAt),
        pinned: false, folderId: null, temporary: false, detailLoaded: false,
        messages: [], deletedAt: null, purgeAt: null,
      }],
    })
    const fetchQuery = vi.fn().mockResolvedValue({ ...summary, responses: [], attachments: [] })

    await hydrateProductionChatPreview({ fetchQuery } as never, 'instance|user-a', 'chat-a', 25)

    expect(fetchQuery).toHaveBeenCalledOnce()
    expect(usePrototypeStore.getState().chats[0]).toMatchObject({ id: 'chat-a', detailLoaded: true })
  })

  it('does not refetch a transcript that is already cached', async () => {
    const summary = chat('chat-a', 'Preview me')
    usePrototypeStore.setState({
      productionNamespace: 'instance|user-a',
      chats: [{
        id: summary.id, title: summary.title, modelId: summary.modelId,
        createdAt: Date.parse(summary.createdAt), updatedAt: Date.parse(summary.updatedAt),
        pinned: false, folderId: null, temporary: false, detailLoaded: true,
        messages: [], deletedAt: null, purgeAt: null,
      }],
    })
    const fetchQuery = vi.fn()

    await hydrateProductionChatPreview({ fetchQuery } as never, 'instance|user-a', 'chat-a', 25)

    expect(fetchQuery).not.toHaveBeenCalled()
  })
})
