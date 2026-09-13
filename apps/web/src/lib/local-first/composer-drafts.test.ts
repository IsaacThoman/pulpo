import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: [] as string[], gate: undefined as Promise<void> | undefined }))

vi.mock('./database', () => ({
  localAccountKey: (userId: string) => `account:${userId}`,
  localDb: {
    drafts: {
      where: () => ({
        equals: ([userId, chatId]: [string, string]) => ({
          first: async () => state.rows.get(`${userId}:${chatId}`),
          delete: async () => { state.rows.delete(`${userId}:${chatId}`) },
        }),
      }),
      put: async (row: Record<string, unknown>) => {
        state.writes.push(String(row.content))
        await state.gate
        state.rows.set(`${row.userId}:${row.chatId}`, row)
      },
    },
  },
}))

const {
  clearRuntimeComposerDrafts,
  loadComposerDraft,
  rememberRuntimeComposerDraft,
  runtimeComposerDraft,
  saveComposerDraft,
} = await import('./composer-drafts')

beforeEach(() => { state.rows.clear(); state.writes = []; state.gate = undefined })

describe('web composer drafts', () => {
  it('persists text and attachment restoration data per account and chat', async () => {
    const attachment = {
      localId: 'local-1', serverId: 'server-1', name: 'notes.txt', size: 5,
      mimeType: 'text/plain', status: 'ready' as const,
    }
    await saveComposerDraft('user-1', 'chat-1', { content: 'first draft', attachments: [attachment] })

    await expect(loadComposerDraft('user-1', 'chat-1')).resolves.toEqual({
      content: 'first draft', attachments: [attachment],
    })
    await expect(loadComposerDraft('user-2', 'chat-1')).resolves.toBeNull()
  })

  it('deletes empty durable drafts and clears only selected runtime scopes', async () => {
    rememberRuntimeComposerDraft('user-1', 'chat-1', { content: 'one', attachmentIds: [], attachments: [] })
    rememberRuntimeComposerDraft('user-1', 'chat-2', { content: 'two', attachmentIds: [], attachments: [] })
    rememberRuntimeComposerDraft('user-2', 'chat-1', { content: 'other', attachmentIds: [], attachments: [] })
    clearRuntimeComposerDrafts('user-1', ['chat-1'])

    expect(runtimeComposerDraft('user-1', 'chat-1')).toBeNull()
    expect(runtimeComposerDraft('user-1', 'chat-2')?.content).toBe('two')
    expect(runtimeComposerDraft('user-2', 'chat-1')?.content).toBe('other')

    await saveComposerDraft('user-1', 'chat-2', { content: 'saved', attachments: [] })
    await saveComposerDraft('user-1', 'chat-2', { content: '', attachments: [] })
    await expect(loadComposerDraft('user-1', 'chat-2')).resolves.toBeNull()
  })
})


it('keeps temporary drafts out of the IndexedDB store shared by browser tabs', async () => {
  await saveComposerDraft('user-1', 'temporary:new', { content: 'private draft', attachments: [] })
  expect(state.rows.size).toBe(0)
  state.rows.set('account:user-1:temporary:new', { content: 'another tab private draft', attachments: [] })
  expect(await loadComposerDraft('user-1', 'temporary:new')).toBeNull()
})


it('persists only the latest of 500 checkpoints queued behind a slow IndexedDB write', async () => {
  let release!: () => void
  state.gate = new Promise<void>((resolve) => { release = resolve })
  const writes = Array.from({ length: 500 }, (_, index) => saveComposerDraft('bulk-user', 'bulk-chat', { content: String(index), attachments: [] }))
  expect(state.writes).toEqual(['0'])
  release()
  await Promise.all(writes)
  expect(state.writes).toEqual(['0', '499'])
  expect(await loadComposerDraft('bulk-user', 'bulk-chat')).toEqual({ content: '499', attachments: [] })
})
