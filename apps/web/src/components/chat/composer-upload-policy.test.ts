import { describe, expect, it } from 'vitest'
import { canSubmitComposerDraft, uploadOutboxHeadAction } from './composer-upload-policy'

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
  it('waits for uploads and recovers failures before considering chat activity', () => {
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['uploading'], restricted: false, provisionalChat: false,
      activeResponse: true, queuedMessageCount: 2,
    })).toBe('wait')
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready', 'error'], restricted: false, provisionalChat: false,
      activeResponse: false, queuedMessageCount: 0,
    })).toBe('recover')
  })

  it('sends provisional heads directly and queues behind durable activity', () => {
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready'], restricted: false, provisionalChat: true,
      activeResponse: true, queuedMessageCount: 1,
    })).toBe('send')
    expect(uploadOutboxHeadAction({
      attachmentStatuses: ['ready'], restricted: false, provisionalChat: false,
      activeResponse: true, queuedMessageCount: 0,
    })).toBe('queue')
  })
})
