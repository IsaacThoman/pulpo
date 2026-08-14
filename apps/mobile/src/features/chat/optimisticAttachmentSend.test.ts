import { describe, expect, it } from 'vitest'
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
