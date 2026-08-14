import { describe, expect, it } from 'vitest'
import {
  canSubmitComposerDraft,
  optimisticSubmissionPlacement,
  uploadOutboxHeadAction,
} from './composer-upload-policy'

describe('composer upload policy', () => {
  it('allows a new message to be staged while its attachment uploads', () => {
    expect(canSubmitComposerDraft({
      modelId: 'model',
      hasText: false,
      attachmentCount: 1,
      uploading: true,
      uploadFailed: false,
      attachmentRestricted: false,
      submitting: false,
      editingExisting: false,
    })).toBe(true)
  })

  it('keeps existing message edits blocked until uploads finish', () => {
    expect(canSubmitComposerDraft({
      modelId: 'model',
      hasText: true,
      attachmentCount: 1,
      uploading: true,
      uploadFailed: false,
      attachmentRestricted: false,
      submitting: false,
      editingExisting: true,
    })).toBe(false)
  })

  it('blocks known failures and attachment restrictions', () => {
    const base = {
      modelId: 'model', hasText: true, attachmentCount: 1, uploading: false,
      uploadFailed: false, attachmentRestricted: false, submitting: false, editingExisting: false,
    }
    expect(canSubmitComposerDraft({ ...base, uploadFailed: true })).toBe(false)
    expect(canSubmitComposerDraft({ ...base, attachmentRestricted: true })).toBe(false)
  })
})

describe('upload outbox head policy', () => {
  it('waits for uploads and recovers failures before considering placement', () => {
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['uploading'], restricted: false, provisionalChat: false,
      placement: 'queue',
    })).toBe('wait')
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready', 'error'], restricted: false, provisionalChat: false,
      placement: 'bubble',
    })).toBe('recover')
  })

  it('sends bubble heads directly and waits to persist queued provisional items', () => {
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready'], restricted: false, provisionalChat: true,
      placement: 'bubble',
    })).toBe('send')
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready'], restricted: false, provisionalChat: true,
      placement: 'queue',
    })).toBe('wait')
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready'], restricted: false, provisionalChat: false,
      placement: 'queue',
    })).toBe('queue')
  })
})

describe('optimistic submission placement', () => {
  const idle = {
    hasChat: true,
    provisionalChat: false,
    activeResponse: false,
    queuedMessageCount: 0,
    pendingSubmissionCount: 0,
    lastMessageRole: 'assistant' as const,
  }

  it('uses the single timeline bubble only for a new or idle chat', () => {
    expect(optimisticSubmissionPlacement({ ...idle, hasChat: false })).toBe('bubble')
    expect(optimisticSubmissionPlacement(idle)).toBe('bubble')
  })

  it('queues immediately behind uploads, responses, provisional chats, and user bubbles', () => {
    expect(optimisticSubmissionPlacement({ ...idle, pendingSubmissionCount: 1 })).toBe('queue')
    expect(optimisticSubmissionPlacement({ ...idle, activeResponse: true })).toBe('queue')
    expect(optimisticSubmissionPlacement({ ...idle, provisionalChat: true })).toBe('queue')
    expect(optimisticSubmissionPlacement({ ...idle, queuedMessageCount: 1 })).toBe('queue')
    expect(optimisticSubmissionPlacement({ ...idle, lastMessageRole: 'user' })).toBe('queue')
  })
})
