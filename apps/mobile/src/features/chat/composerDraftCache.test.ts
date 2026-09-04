import { beforeEach, describe, expect, it } from 'vitest'
import {
  cacheComposerDraft,
  cachedComposerDraft,
  clearComposerDraftCacheNamespace,
  composerDraftScope,
  deleteCachedComposerDraft,
} from './composerDraftCache'

const namespaces = ['https://one.example|user', 'https://two.example|user']

beforeEach(() => namespaces.forEach(clearComposerDraftCacheNamespace))

describe('mobile composer draft cache', () => {
  it('isolates chat and new-chat drafts by account namespace', () => {
    const firstChat = composerDraftScope(namespaces[0]!, 'chat-1')
    const newChat = composerDraftScope(namespaces[0]!, 'new')
    const otherAccount = composerDraftScope(namespaces[1]!, 'chat-1')
    cacheComposerDraft(firstChat, { body: 'chat draft', attachments: [{ id: 'a' }] })
    cacheComposerDraft(newChat, { body: 'new draft', attachments: [] })
    cacheComposerDraft(otherAccount, { body: 'other draft', attachments: [] })

    expect(cachedComposerDraft(firstChat)?.body).toBe('chat draft')
    expect(cachedComposerDraft(newChat)?.body).toBe('new draft')
    expect(cachedComposerDraft(otherAccount)?.body).toBe('other draft')
  })

  it('removes empty, sent, and signed-out draft scopes', () => {
    const first = composerDraftScope(namespaces[0]!, 'chat-1')
    const second = composerDraftScope(namespaces[0]!, 'chat-2')
    cacheComposerDraft(first, { body: 'one', attachments: [] })
    cacheComposerDraft(second, { body: 'two', attachments: [] })
    cacheComposerDraft(first, { body: '', attachments: [] })
    expect(cachedComposerDraft(first)).toBeNull()

    deleteCachedComposerDraft(second)
    expect(cachedComposerDraft(second)).toBeNull()
    cacheComposerDraft(second, { body: 'again', attachments: [] })
    clearComposerDraftCacheNamespace(namespaces[0]!)
    expect(cachedComposerDraft(second)).toBeNull()
  })
})
