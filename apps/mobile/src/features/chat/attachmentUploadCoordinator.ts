export type CoordinatedUploadState = 'local' | 'uploading' | 'ready' | 'failed'

export interface CoordinatedUpload {
  localId: string
  ownerId: string
  attempt: number
  managed: boolean
  serverId?: string
  state: CoordinatedUploadState
  error?: string
}

export type UploadSuccess<T extends CoordinatedUpload> =
  | { disposition: 'apply'; item: T }
  | { disposition: 'cleanup'; serverId: string }

export function startUploadAttempt<T extends CoordinatedUpload>(item: T): T {
  return {
    ...item,
    attempt: item.attempt + 1,
    state: 'uploading',
    error: undefined,
  }
}

export function settleUploadSuccess<T extends CoordinatedUpload>(input: {
  attempted: T
  current?: T
  serverId: string
  patch?: Partial<T>
}): UploadSuccess<T> {
  const { attempted, current, serverId, patch } = input
  if (!current || current.ownerId !== attempted.ownerId || current.attempt !== attempted.attempt) {
    return { disposition: 'cleanup', serverId }
  }
  return {
    disposition: 'apply',
    item: {
      ...current,
      ...patch,
      serverId,
      state: 'ready',
      error: undefined,
    },
  }
}

export function settleUploadFailure<T extends CoordinatedUpload>(input: {
  attempted: T
  current?: T
  error: string
}): T | undefined {
  const { attempted, current, error } = input
  if (!current || current.ownerId !== attempted.ownerId || current.attempt !== attempted.attempt) return current
  return { ...current, state: 'failed', error }
}

export function attachmentSendPolicy(
  attachments: readonly CoordinatedUpload[],
  options: { editing: boolean },
): { allowed: boolean; reason?: 'failed' | 'uploading' } {
  if (attachments.some((attachment) => attachment.state === 'failed')) {
    return { allowed: false, reason: 'failed' }
  }
  if (options.editing && attachments.some((attachment) => attachment.state !== 'ready')) {
    return { allowed: false, reason: 'uploading' }
  }
  return { allowed: true }
}

export function cleanupServerIdOnRemoval(
  attachment: CoordinatedUpload,
  protectedServerIds: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!attachment.managed || !attachment.serverId || protectedServerIds.has(attachment.serverId)) return undefined
  return attachment.serverId
}
