export function canSubmitComposerDraft(input: {
  modelId: string
  hasText: boolean
  attachmentCount: number
  uploading: boolean
  uploadFailed: boolean
  attachmentRestricted: boolean
  submitting: boolean
  editingExisting: boolean
}): boolean {
  return Boolean(input.modelId)
    && !input.uploadFailed
    && !input.attachmentRestricted
    && !input.submitting
    && (!input.editingExisting || !input.uploading)
    && (input.hasText || input.attachmentCount > 0)
}

export function uploadOutboxHeadAction(input: {
  attachmentStatuses: ('uploading' | 'ready' | 'error')[]
  restricted: boolean
  provisionalChat: boolean
  activeResponse: boolean
  queuedMessageCount: number
}): 'wait' | 'recover' | 'send' | 'queue' {
  if (input.attachmentStatuses.includes('error') || input.restricted) return 'recover'
  if (input.attachmentStatuses.includes('uploading')) return 'wait'
  if (!input.provisionalChat && (input.activeResponse || input.queuedMessageCount > 0)) return 'queue'
  return 'send'
}
