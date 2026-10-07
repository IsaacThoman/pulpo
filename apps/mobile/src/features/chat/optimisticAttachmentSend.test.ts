import { describe, expect, it } from 'vitest'
import { createChatSchema } from '@pulpo/contracts'
import {
  createOptimisticSendIdentity,
  readyTranscriptAttachments,
  restoreLatestDraft,
  stagedTranscriptAttachments,
  type StagedAttachment,
} from './optimisticAttachmentSend'

const uploading: StagedAttachment = {
  localId: 'local-image', name: 'photo.heic', uri: 'file:///photo.heic', mimeType: 'image/heic',
  size: 42, kind: 'image', state: 'uploading',
}

describe('optimistic attachment sends', () => {
  it('uses the uploaded cache for imported files after their originals are released', () => {
    expect(readyTranscriptAttachments([{ ...uploading, localId: 'import:uuid', state: 'ready', serverId: 'server-image' }])[0])
      .toMatchObject({ uri: '', id: 'server-image', mimeType: 'image/heic' })
  })
  it('creates stable new-chat, response, and input IDs before dispatch', () => {
    const ids = ['response-id', 'chat-id']
    expect(createOptimisticSendIdentity({
      content: '', firstAttachmentName: 'photo.heic', createId: () => ids.shift()!,
    })).toEqual({
      chatId: 'chat-id', responseId: 'response-id', inputMessageId: 'response-id:input', title: 'photo.heic',
    })
  })

  it('keeps an existing chat ID and derives a concise title from content', () => {
    expect(createOptimisticSendIdentity({
      activeChatId: 'existing', content: 'one two three four five six seven eight', createId: () => 'response',
    })).toEqual({
      chatId: 'existing', responseId: 'response', inputMessageId: 'response:input', title: 'one two three four five six seven',
    })
  })

  it.each([
    ['a long URL', `Explain this meme to me https://example.com/meme?share=${'a'.repeat(250)}`, 'photo.heic'],
    ['unbroken text', '界'.repeat(201), 'photo.heic'],
    ['a long attachment filename', '', `${'a'.repeat(220)}.heic`],
  ])('keeps generated titles within the API limit for %s', (_scenario, content, firstAttachmentName) => {
    const { title } = createOptimisticSendIdentity({ content, firstAttachmentName, createId: () => 'response' })

    expect(title).toHaveLength(200)
    expect(createChatSchema.safeParse({ modelId: 'model-1', title }).success).toBe(true)
  })

  it('preserves a title exactly at the API limit', () => {
    const content = `${'a'.repeat(198)}😀`
    const { title } = createOptimisticSendIdentity({ content, createId: () => 'response' })

    expect(title).toBe(content)
    expect(createChatSchema.safeParse({ modelId: 'model-1', title }).success).toBe(true)
  })

  it('does not split an emoji at the title limit', () => {
    const { title } = createOptimisticSendIdentity({ content: `${'a'.repeat(199)}😀`, createId: () => 'response' })

    expect(title).toBe('a'.repeat(199))
    expect(title.isWellFormed()).toBe(true)
    expect(createChatSchema.safeParse({ modelId: 'model-1', title }).success).toBe(true)
  })

  it('stages local upload state then swaps in confirmed server IDs for dispatch', () => {
    expect(stagedTranscriptAttachments([uploading])).toEqual([{
      id: 'local-image', name: 'photo.heic', uri: 'file:///photo.heic', mimeType: 'image/heic',
      sizeBytes: 42, kind: 'image', status: 'uploading', error: undefined,
    }])
    expect(readyTranscriptAttachments([{ ...uploading, state: 'ready', serverId: 'server-image' }])).toEqual([{
      id: 'server-image', name: 'photo.heic', uri: 'file:///photo.heic', mimeType: 'image/heic',
      sizeBytes: 42, kind: 'image', status: 'ready',
    }])
  })

  it('restores the complete draft with its latest failure state', () => {
    const failed = { ...uploading, state: 'failed' as const, error: 'Connection lost' }
    expect(restoreLatestDraft([uploading], new Map([[uploading.localId, failed]]))).toEqual([failed])
  })

  it('restores a preserved composer with uploads completed during an atomic edit', () => {
    const ready = { ...uploading, state: 'ready' as const, serverId: 'server-image' }
    expect(restoreLatestDraft([uploading], new Map([[uploading.localId, ready]]))).toEqual([ready])
  })
})
