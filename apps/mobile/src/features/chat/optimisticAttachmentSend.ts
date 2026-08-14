import type { CoordinatedUploadState } from './attachmentUploadCoordinator'

export interface StagedAttachment {
  localId: string
  serverId?: string
  name: string
  uri: string
  mimeType: string
  size?: number
  kind: 'image' | 'file'
  state: CoordinatedUploadState
  error?: string
}

export interface TranscriptAttachment {
  id: string
  name: string
  uri: string
  mimeType: string
  sizeBytes: number
  kind: 'image' | 'file'
  status: 'uploading' | 'ready' | 'failed'
  error?: string
}

export interface OptimisticSendIdentity {
  chatId: string
  responseId: string
  inputMessageId: string
  title: string
}

export function createOptimisticSendIdentity(input: {
  activeChatId?: string | null
  content: string
  firstAttachmentName?: string
  createId: () => string
}): OptimisticSendIdentity {
  const responseId = input.createId()
  const trimmed = input.content.trim()
  return {
    chatId: input.activeChatId ?? input.createId(),
    responseId,
    inputMessageId: `${responseId}:input`,
    title: trimmed
      ? trimmed.split(/\s+/).slice(0, 7).join(' ')
      : input.firstAttachmentName ?? 'Attachment chat',
  }
}

export function stagedTranscriptAttachments(attachments: readonly StagedAttachment[]): TranscriptAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.serverId ?? attachment.localId,
    name: attachment.name,
    uri: attachment.uri,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size ?? 0,
    kind: attachment.kind,
    status: attachment.state === 'ready' ? 'ready' : attachment.state === 'failed' ? 'failed' : 'uploading',
    error: attachment.error,
  }))
}

export function readyTranscriptAttachments(
  attachments: readonly (StagedAttachment & { serverId: string; state: 'ready' })[],
): TranscriptAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.serverId,
    name: attachment.name,
    uri: attachment.uri,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size ?? 0,
    kind: attachment.kind,
    status: 'ready',
  }))
}

export function restoreLatestDraft<T extends { localId: string }>(
  original: readonly T[],
  latest: ReadonlyMap<string, T>,
): T[] {
  return original.map((attachment) => latest.get(attachment.localId) ?? attachment)
}
