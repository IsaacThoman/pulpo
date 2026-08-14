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

export function optimisticSubmissionPlacement(input: {
  hasChat: boolean
  provisionalChat: boolean
  activeResponse: boolean
  queuedMessageCount: number
  pendingSubmissionCount: number
  lastMessageRole?: 'user' | 'assistant' | 'system'
}): 'bubble' | 'queue' {
  if (!input.hasChat) return 'bubble'
  if (
    input.provisionalChat
    || input.activeResponse
    || input.queuedMessageCount > 0
    || input.pendingSubmissionCount > 0
    || input.lastMessageRole === 'user'
  ) return 'queue'
  return 'bubble'
}

export function uploadOutboxHeadAction(input: {
  attachmentStatuses: ('uploading' | 'ready' | 'error')[]
  restricted: boolean
  placement: 'bubble' | 'queue'
  provisionalChat: boolean
}): 'wait' | 'recover' | 'send' | 'queue' {
  if (input.attachmentStatuses.includes('error') || input.restricted) return 'recover'
  if (input.attachmentStatuses.includes('uploading')) return 'wait'
  if (input.placement === 'queue') return input.provisionalChat ? 'wait' : 'queue'
  return 'send'
}
