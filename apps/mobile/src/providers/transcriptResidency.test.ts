import { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PrototypeChat } from '../mockup5/src/domain'
import type { ServerChat } from '../types'
const mocks = vi.hoisted(() => ({ chats: [] as PrototypeChat[], pending: new Set<string>(), namespace: 'n', release: vi.fn() }))
vi.mock('../data/database', () => ({ cachedChatBytes: async () => 1024 }))
vi.mock('../features/chat/projectorCache', () => ({ releaseChatProjector: mocks.release }))
vi.mock('../mockup5/src/production/optimisticResponses', () => ({ pendingOptimisticResponseIds: (_n: string, id: string) => mocks.pending.has(id) ? ['pending'] : [] }))
vi.mock('../mockup5/src/store/prototypeStore', () => ({ usePrototypeStore: {
  getState: () => ({ productionNamespace: mocks.namespace, chats: mocks.chats }),
  setState: (fn: (state: { chats: PrototypeChat[] }) => { chats: PrototypeChat[] }) => { mocks.chats = fn({ chats: mocks.chats }).chats },
} }))
import { startTranscriptResidency } from './transcriptResidency'
import { useRealtimeStore } from './realtimeStore'
import { resetTranscriptResidency } from '../data/transcriptResidency'
beforeEach(() => { resetTranscriptResidency(); useRealtimeStore.getState().resetSnapshots(); mocks.chats = []; mocks.pending.clear(); mocks.namespace = 'n'; vi.clearAllMocks() })
it('evicts all memory owners together while preserving running and optimistic transcripts', async () => {
  const client = new QueryClient()
  const owner = startTranscriptResidency(client, 'n')
  owner.activate('19')
  mocks.pending.add('0')
  for (let i = 0; i < 20; i++) {
    const id = String(i)
    const snapshot = { responseId: id, sequence: 1, status: i === 1 ? 'in_progress' as const : 'completed' as const, output: [], usage: null, error: null, updatedAt: '' }
    useRealtimeStore.getState().receiveSnapshot(snapshot)
    mocks.chats.push({ id, messages: [{ id }], detailLoaded: true } as PrototypeChat)
    client.setQueryData(['chat', 'n', id], { id, responses: [{ id, status: snapshot.status }], queuedMessages: [] } as unknown as ServerChat)
  }
  await vi.waitFor(() => expect(client.getQueryCache().findAll()).toHaveLength(8))
  expect(mocks.chats.filter((chat) => chat.detailLoaded)).toHaveLength(8)
  expect(Object.keys(useRealtimeStore.getState().snapshots)).toHaveLength(8)
  expect(client.getQueryData(['chat', 'n', '0'])).toBeDefined()
  expect(client.getQueryData(['chat', 'n', '1'])).toBeDefined()
  expect(mocks.release).toHaveBeenCalled()
  useRealtimeStore.getState().receiveSnapshot({ responseId: '2', sequence: 2, status: 'completed', output: [], usage: null, error: null, updatedAt: '' })
  await vi.waitFor(() => expect(useRealtimeStore.getState().snapshots['2']).toBeUndefined())
  owner.dispose(); client.clear()
})
it('coordinates query garbage collection with projected state and terminal snapshots', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 10 } } })
  const owner = startTranscriptResidency(client, 'n')
  const snapshot = { responseId: 'response', sequence: 1, status: 'completed' as const, output: [], usage: null, error: null, updatedAt: '' }
  useRealtimeStore.getState().receiveSnapshot(snapshot)
  mocks.chats.push({ id: 'chat', messages: [{ id: 'response' }], detailLoaded: true } as PrototypeChat)
  client.setQueryData(['chat', 'n', 'chat'], { id: 'chat', responses: [{ id: 'response', status: 'completed' }] } as ServerChat)
  await vi.waitFor(() => expect(mocks.chats[0]?.detailLoaded).toBe(false))
  expect(useRealtimeStore.getState().snapshots.response).toBeUndefined()
  expect(client.getQueryData(['chat', 'n', 'chat'])).toBeUndefined()
  owner.dispose(); client.clear()
})
