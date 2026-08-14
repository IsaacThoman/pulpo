import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerChat, ServerResponse } from '../../../types'
import {
  activateOptimisticBranch,
  clearOptimisticBranchSelections,
  reconcileOptimisticBranchSelection,
} from './optimisticBranches'

const namespace = 'https://pulpo.test:user-1'
const chatId = 'chat-1'
const key = ['chat', namespace, chatId] as const

function response(id: string, parentResponseId: string | null): ServerResponse {
  const createdAt = `2026-08-04T00:00:0${id === 'a' ? 1 : id === 'b' ? 2 : 3}.000Z`
  return {
    id,
    parentResponseId,
    previousResponseId: parentResponseId,
    userMessageId: `${id}:input`,
    modelId: 'model-1',
    status: 'completed',
    input: [],
    output: [],
    presetSelections: {},
    agentMode: false,
    usage: null,
    error: null,
    createdAt,
    completedAt: createdAt,
    snapshot: {
      responseId: id,
      status: 'completed',
      sequence: 1,
      output: [],
      usage: null,
      error: null,
      updatedAt: createdAt,
    },
    branches: {
      user: { ids: [id], index: 0 },
      assistant: { ids: [id], index: 0 },
    },
  }
}

function chat(): ServerChat {
  return {
    id: chatId,
    title: 'Branches',
    modelId: 'model-1',
    pinned: false,
    folderId: null,
    sortOrder: 0,
    temporary: false,
    activeResponseId: 'c',
    activeBranchLeafId: 'c',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:03.000Z',
    responses: [response('a', null), response('b', null), response('c', 'b')],
    attachments: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('optimistic branch activation', () => {
  beforeEach(() => clearOptimisticBranchSelections())

  it('selects the newest descendant immediately without waiting for the server', async () => {
    const queryClient = new QueryClient()
    const initial = { ...chat(), activeResponseId: 'a', activeBranchLeafId: 'a' }
    queryClient.setQueryData(key, initial)
    const request = deferred<{ activeBranchLeafId: string }>()

    const activation = activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'b',
      request: () => request.promise,
    })

    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')
    request.resolve({ activeBranchLeafId: 'c' })
    await activation
  })

  it('keeps a pending selection visible over a stale transcript refetch', async () => {
    const queryClient = new QueryClient()
    const current = chat()
    queryClient.setQueryData(key, current)
    const request = deferred<{ activeBranchLeafId: string }>()
    const activation = activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'a',
      request: () => request.promise,
    })

    const reconciled = reconcileOptimisticBranchSelection(namespace, current)
    expect(reconciled.activeBranchLeafId).toBe('a')
    request.resolve({ activeBranchLeafId: 'a' })
    await activation
  })

  it('reconciles the authoritative leaf returned by the server', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, chat())

    await activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'a',
      request: async () => ({ activeBranchLeafId: 'a' }),
    })

    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('a')
  })

  it('hydrates an uncached branch from the activation response without a follow-up fetch', async () => {
    const queryClient = new QueryClient()
    const initial = { ...chat(), activeResponseId: 'a', activeBranchLeafId: 'a' }
    initial.responses = initial.responses?.map((item) => ({
      ...item,
      detailAvailable: item.id === 'a',
    }))
    queryClient.setQueryData(key, initial)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const onCacheUpdated = vi.fn()

    await activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'b',
      request: async () => ({
        activeBranchLeafId: 'c',
        responses: chat().responses?.map((item) => ({
          ...item,
          detailAvailable: item.id !== 'a',
        })),
      }),
      onCacheUpdated,
    })

    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')
    expect(invalidate).not.toHaveBeenCalled()
    expect(onCacheUpdated).toHaveBeenCalledWith(expect.objectContaining({ activeBranchLeafId: 'c' }))
  })

  it('falls back to refetching an uncached branch from an older server response', async () => {
    const queryClient = new QueryClient()
    const initial = { ...chat(), activeResponseId: 'a', activeBranchLeafId: 'a' }
    initial.responses = initial.responses?.map((item) => ({
      ...item,
      detailAvailable: item.id === 'a',
    }))
    queryClient.setQueryData(key, initial)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'b',
      request: async () => ({ activeBranchLeafId: 'c' }),
    })

    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('a')
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('does not switch when an ancestor in the selected lineage is still a stub', async () => {
    const queryClient = new QueryClient()
    const initial = { ...chat(), activeResponseId: 'a', activeBranchLeafId: 'a' }
    initial.responses = initial.responses?.map((item) => ({
      ...item,
      detailAvailable: item.id !== 'b',
    }))
    queryClient.setQueryData(key, initial)
    const request = deferred<{ activeBranchLeafId: string }>()

    const activation = activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'b',
      request: () => request.promise,
    })

    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('a')
    request.resolve({ activeBranchLeafId: 'c' })
    await activation
  })

  it('rolls back the latest selection when activation fails', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, chat())

    await expect(activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: 'a',
      request: async () => { throw new Error('offline') },
    })).rejects.toThrow('offline')

    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')
  })

  it('serializes rapid selections and ignores an older completion', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, chat())
    const first = deferred<{ activeBranchLeafId: string }>()
    const second = deferred<{ activeBranchLeafId: string }>()
    const calls: string[] = []
    const request = (id: string) => {
      calls.push(id)
      return id === 'a' ? first.promise : second.promise
    }

    const selectA = activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: 'a', request })
    const selectB = activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: 'b', request })
    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')
    expect(calls).toEqual([])

    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['a'])
    first.resolve({ activeBranchLeafId: 'a' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['a', 'b'])
    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')

    second.resolve({ activeBranchLeafId: 'c' })
    await Promise.all([selectA, selectB])
    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')
  })

  it('caches an older activation payload without overriding the newest visible selection', async () => {
    const queryClient = new QueryClient()
    const initial = { ...chat(), activeResponseId: 'a', activeBranchLeafId: 'a' }
    initial.responses = initial.responses?.map((item) => ({
      ...item,
      detailAvailable: item.id === 'a',
    }))
    queryClient.setQueryData(key, initial)
    const first = deferred<{ activeBranchLeafId: string; responses?: ServerResponse[] }>()
    const second = deferred<{ activeBranchLeafId: string; responses?: ServerResponse[] }>()
    const request = (id: string) => id === 'b' ? first.promise : second.promise

    const selectB = activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: 'b', request })
    const selectA = activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: 'a', request })
    await Promise.resolve()
    await Promise.resolve()
    first.resolve({
      activeBranchLeafId: 'c',
      responses: chat().responses?.map((item) => ({ ...item, detailAvailable: item.id !== 'a' })),
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const cached = queryClient.getQueryData<ServerChat>(key)
    expect(cached?.activeBranchLeafId).toBe('a')
    expect(cached?.responses?.find((item) => item.id === 'c')?.detailAvailable).toBe(true)

    second.resolve({ activeBranchLeafId: 'a' })
    await Promise.all([selectA, selectB])
  })

  it('rolls back to the last authoritative leaf when queued selections both fail', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, chat())
    const first = deferred<{ activeBranchLeafId: string }>()
    const second = deferred<{ activeBranchLeafId: string }>()
    const request = (id: string) => id === 'a' ? first.promise : second.promise

    const selectA = activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: 'a', request })
    const selectB = activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: 'b', request })
    first.reject(new Error('first failed'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    second.reject(new Error('second failed'))

    await expect(Promise.all([selectA, selectB])).rejects.toThrow('second failed')
    expect(queryClient.getQueryData<ServerChat>(key)?.activeBranchLeafId).toBe('c')
  })
})
