import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }))

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

beforeEach(() => state.rows.clear())

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
