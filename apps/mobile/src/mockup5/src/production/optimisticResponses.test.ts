import { QueryClient } from '@tanstack/react-query'
import type { ResponseSnapshot } from '@pulpo/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerChat } from '../../../types'
import {
  acknowledgeOptimisticChatList,
  applyConfirmedMessageDeletion,
  cacheOptimisticBranch,
  cacheOptimisticTurn,
  clearPendingOptimisticResponses,
  discardOptimisticChat,
  pendingOptimisticChatIds,
  reconcileOptimisticResponses,
  rejectOptimisticTurn,
} from './optimisticResponses'

const { realtime } = vi.hoisted(() => ({
  realtime: {
    snapshots: {} as Record<string, unknown>,
    receiveSnapshot(snapshot: { responseId: string }) { this.snapshots[snapshot.responseId] = snapshot },
    removeSnapshot(responseId: string) { delete this.snapshots[responseId] },
    resetSnapshots() { this.snapshots = {} },
  },
}))

vi.mock('../../../providers/realtimeStore', () => ({
  useRealtimeStore: { getState: () => realtime },
}))

const namespace = 'https://pulpo.test:user-1'
const chatKey = (chatId: string) => ['chat', namespace, chatId] as const

function staleChat(id = 'chat-1'): ServerChat {
  return {
    id,
    title: 'Existing chat',
    modelId: 'model-1',
    pinned: false,
    folderId: null,
    sortOrder: 0,
    temporary: false,
    activeResponseId: null,
    activeBranchLeafId: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    responses: [],
    attachments: [],
  }
}

function seed(queryClient: QueryClient, chatId = 'chat-1', responseId = 'response-1'): void {
  cacheOptimisticTurn({
    queryClient,
    namespace,
    chatId,
    responseId,
    parentResponseId: null,
    content: 'Hello',
    title: 'Hello',
    modelId: 'model-1',
    temporary: false,
    presetSelections: {},
    agentMode: false,
    attachments: [{ id: 'attachment-1', name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 12 }],
    createdAt: Date.parse('2026-08-04T00:00:01.000Z'),
  })
}

describe('optimistic response reconciliation', () => {
  beforeEach(() => {
    clearPendingOptimisticResponses()
    realtime.resetSnapshots()
  })

  it('seeds the transcript and realtime base before the server acknowledges the turn', () => {
    const queryClient = new QueryClient()
    seed(queryClient)

    const cached = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))
    expect(cached?.responses?.map((response) => response.id)).toEqual(['response-1'])
    expect(cached?.activeBranchLeafId).toBe('response-1')
    expect((realtime.snapshots['response-1'] as { status?: string } | undefined)?.status).toBe('queued')
  })

  it('forgets pending response state when a temporary chat is abandoned', () => {
    const queryClient = new QueryClient()
    seed(queryClient, 'temporary-chat', 'temporary-response')

    discardOptimisticChat(namespace, 'temporary-chat')

    expect(pendingOptimisticChatIds(namespace)).toEqual(new Set())
    expect(realtime.snapshots['temporary-response']).toBeUndefined()
  })

  it('keeps the optimistic turn when a stale empty transcript arrives', () => {
    const queryClient = new QueryClient()
    seed(queryClient)

    const reconciled = reconcileOptimisticResponses(namespace, staleChat(), realtime.snapshots as never)
    expect(reconciled.responses?.map((response) => response.id)).toEqual(['response-1'])
    expect(reconciled.activeBranchLeafId).toBe('response-1')
    expect(reconciled.attachments?.map((attachment) => attachment.id)).toEqual(['attachment-1'])
  })

  it('projects the newest live output even while transcript persistence lags', () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    const snapshots = {
      'response-1': {
        responseId: 'response-1',
        status: 'in_progress' as const,
        sequence: 1,
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Immediate' }] }],
        usage: null,
        error: null,
        updatedAt: '2026-08-04T00:00:02.000Z',
      },
    }

    const reconciled = reconcileOptimisticResponses(namespace, staleChat(), snapshots)
    expect(reconciled.responses?.[0]?.status).toBe('in_progress')
    expect(reconciled.responses?.[0]?.output).toEqual(snapshots['response-1'].output)
  })

  it('keeps the accepted turn selected while server branch and attachment metadata lag', () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    const optimistic = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.responses?.[0]
    expect(optimistic).toBeDefined()
    const partiallyPersisted: ServerChat = {
      ...staleChat(),
      responses: [optimistic!],
      attachments: [],
      activeResponseId: null,
      activeBranchLeafId: null,
    }

    const reconciled = reconcileOptimisticResponses(namespace, partiallyPersisted, realtime.snapshots as never)
    expect(reconciled.activeResponseId).toBe('response-1')
    expect(reconciled.activeBranchLeafId).toBe('response-1')
    expect(reconciled.attachments?.map((attachment) => attachment.id)).toEqual(['attachment-1'])
  })

  it('marks a newly-created chat as protected from stale chat-list replacement', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['chats', namespace], [staleChat('older-chat')])
    seed(queryClient, 'new-chat')
    expect(pendingOptimisticChatIds(namespace)).toEqual(new Set(['new-chat']))
    expect(queryClient.getQueryData<ServerChat[]>(['chats', namespace])?.map((chat) => chat.id)).toEqual(['older-chat'])
  })

  it('releases new-chat protection only after terminal detail and chat-list persistence', () => {
    const queryClient = new QueryClient()
    seed(queryClient, 'new-chat')
    const optimistic = queryClient.getQueryData<ServerChat>(chatKey('new-chat'))?.responses?.[0]
    expect(optimistic).toBeDefined()
    const completedSnapshot = {
      responseId: 'response-1',
      status: 'completed' as const,
      sequence: 2,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }],
      usage: null,
      error: null,
      updatedAt: '2026-08-04T00:00:03.000Z',
    }
    const authoritative: ServerChat = {
      ...staleChat('new-chat'),
      activeResponseId: 'response-1',
      activeBranchLeafId: 'response-1',
      responses: [{
        ...optimistic!,
        status: 'completed',
        output: completedSnapshot.output,
        completedAt: completedSnapshot.updatedAt,
        snapshot: completedSnapshot,
      }],
    }

    reconcileOptimisticResponses(namespace, authoritative, { 'response-1': completedSnapshot })
    expect(pendingOptimisticChatIds(namespace)).toEqual(new Set(['new-chat']))

    acknowledgeOptimisticChatList(namespace, new Set(['new-chat']))
    expect(pendingOptimisticChatIds(namespace)).toEqual(new Set())
  })

  it('rolls back an unaccepted optimistic turn', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatKey('chat-1'), staleChat())
    seed(queryClient)

    rejectOptimisticTurn({ queryClient, namespace, responseId: 'response-1', discardChat: false })

    const cached = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))
    expect(cached?.responses).toEqual([])
    expect(realtime.snapshots['response-1']).toBeUndefined()
    expect(pendingOptimisticChatIds(namespace)).toEqual(new Set())
  })

  it('shows a regenerated branch immediately and rolls back to its source', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatKey('chat-1'), staleChat())
    seed(queryClient)

    const branch = cacheOptimisticBranch({
      queryClient,
      namespace,
      chatId: 'chat-1',
      sourceResponseId: 'response-1',
      responseId: 'response-2',
      modelId: 'model-1',
      presetSelections: {},
      createdAt: Date.parse('2026-08-04T00:00:02.000Z'),
    })

    expect(branch?.branches.assistant.ids).toEqual(['response-2'])
    const optimistic = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))
    expect(optimistic?.activeBranchLeafId).toBe('response-2')
    expect(optimistic?.responses?.find((response) => response.id === 'response-2')?.branches.assistant.ids)
      .toEqual(['response-1', 'response-2'])

    rejectOptimisticTurn({ queryClient, namespace, responseId: 'response-2', discardChat: false })
    expect(queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.activeBranchLeafId).toBe('response-1')
  })

  it('creates visible user and assistant edit branches with caller-owned IDs', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatKey('chat-1'), staleChat())
    seed(queryClient)

    cacheOptimisticBranch({
      queryClient, namespace, chatId: 'chat-1', sourceResponseId: 'response-1', responseId: 'response-2',
      modelId: 'model-1', presetSelections: {}, editedInput: 'Edited prompt',
      editedAttachments: [{ id: 'attachment-2', name: 'replacement.pdf', mimeType: 'application/pdf', sizeBytes: 24 }],
      agentMode: true,
      createdAt: Date.parse('2026-08-04T00:00:02.000Z'),
    })
    const userEdit = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.responses?.find((response) => response.id === 'response-2')
    expect(userEdit?.branches.user.ids).toEqual(['response-1', 'response-2'])
    expect(JSON.stringify(userEdit?.input)).toContain('Edited prompt')
    expect(JSON.stringify(userEdit?.input)).toContain('attachment-2')
    expect(userEdit?.agentMode).toBe(true)
    expect(queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.attachments?.map((attachment) => attachment.id))
      .toContain('attachment-2')

    cacheOptimisticBranch({
      queryClient, namespace, chatId: 'chat-1', sourceResponseId: 'response-2', responseId: 'response-3',
      modelId: 'model-1', presetSelections: {}, editedOutput: 'Edited answer', createdAt: Date.parse('2026-08-04T00:00:03.000Z'),
    })
    const assistantEdit = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.responses?.find((response) => response.id === 'response-3')
    expect(assistantEdit?.status).toBe('completed')
    expect(JSON.stringify(assistantEdit?.output)).toContain('Edited answer')
    expect(assistantEdit?.branches.assistant.ids).toEqual(['response-2', 'response-3'])
  })

  it.each(['queued', 'in_progress'] as const)('keeps an edited branch parallel with a %s response', (status) => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatKey('chat-1'), staleChat())
    seed(queryClient)
    const initial = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))!
    const original = initial.responses![0]!
    const originalSnapshot: ResponseSnapshot = {
      ...original.snapshot,
      status,
      sequence: status === 'in_progress' ? 1 : 0,
      output: original.output,
    }

    cacheOptimisticBranch({
      queryClient, namespace, chatId: 'chat-1', sourceResponseId: 'response-1', responseId: 'response-2',
      modelId: 'model-1', presetSelections: {}, editedInput: 'Edited while generating',
      createdAt: Date.parse('2026-08-04T00:00:02.000Z'),
    })

    const optimistic = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))!
    const edited = optimistic.responses?.find((response) => response.id === 'response-2')
    expect(optimistic.activeBranchLeafId).toBe('response-2')
    expect(edited?.parentResponseId).toBe(original.parentResponseId)
    expect(edited?.userMessageId).not.toBe(original.userMessageId)

    const editedSnapshot: ResponseSnapshot = {
      ...edited!.snapshot,
      status: 'in_progress' as const,
      sequence: 1,
      output: edited!.output,
    }
    const reconciled = reconcileOptimisticResponses(namespace, {
      ...staleChat(),
      activeResponseId: 'response-1',
      activeBranchLeafId: 'response-1',
      responses: [{ ...original, status, snapshot: originalSnapshot }],
    }, {
      'response-1': originalSnapshot,
      'response-2': editedSnapshot,
    })
    expect(reconciled.responses?.find((response) => response.id === 'response-1')?.status).toBe(status)
    expect(reconciled.responses?.find((response) => response.id === 'response-2')?.status).toBe('in_progress')
    expect(reconciled.activeBranchLeafId).toBe('response-2')
  })

  it('restores the exact active descendant when an earlier-message edit is rejected', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatKey('chat-1'), staleChat())
    seed(queryClient)
    cacheOptimisticTurn({
      queryClient,
      namespace,
      chatId: 'chat-1',
      responseId: 'response-follow-up',
      parentResponseId: 'response-1',
      content: 'Follow up',
      title: 'Follow up',
      modelId: 'model-1',
      temporary: false,
      presetSelections: {},
      agentMode: false,
      attachments: [],
      createdAt: Date.parse('2026-08-04T00:00:02.000Z'),
    })
    clearPendingOptimisticResponses()

    cacheOptimisticBranch({
      queryClient, namespace, chatId: 'chat-1', sourceResponseId: 'response-1', responseId: 'response-edit',
      modelId: 'model-1', presetSelections: {}, editedInput: 'Edited root',
      createdAt: Date.parse('2026-08-04T00:00:03.000Z'),
    })
    expect(queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.activeBranchLeafId).toBe('response-edit')

    rejectOptimisticTurn({ queryClient, namespace, responseId: 'response-edit', discardChat: false })

    expect(queryClient.getQueryData<ServerChat>(chatKey('chat-1'))?.activeBranchLeafId).toBe('response-follow-up')
  })

  it('applies a confirmed user-message cascade without waiting for a refetch', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatKey('chat-1'), staleChat())
    seed(queryClient)
    cacheOptimisticBranch({
      queryClient, namespace, chatId: 'chat-1', sourceResponseId: 'response-1', responseId: 'response-2',
      modelId: 'model-1', presetSelections: {}, createdAt: Date.parse('2026-08-04T00:00:02.000Z'),
    })

    applyConfirmedMessageDeletion({ queryClient, namespace, chatId: 'chat-1', messageId: 'response-1:input' })

    const cached = queryClient.getQueryData<ServerChat>(chatKey('chat-1'))
    expect(cached?.responses).toEqual([])
    expect(cached?.activeBranchLeafId).toBeNull()
  })
})
