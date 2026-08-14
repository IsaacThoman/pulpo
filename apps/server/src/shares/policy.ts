import type { ChatShareSnapshot } from '@pulpo/contracts'

export interface SnapshotShareState {
  userId: string
  encryptedToken: string | null
  snapshot: ChatShareSnapshot | null
  expiresAt: Date | null
  revokedAt: Date | null
}

export function snapshotShareIsActive(share: SnapshotShareState, now = new Date()): boolean {
  return Boolean(
    share.encryptedToken
    && share.snapshot
    && !share.revokedAt
    && (!share.expiresAt || share.expiresAt > now),
  )
}

export function snapshotShareCanBeRevoked(share: SnapshotShareState, userId: string): boolean {
  return share.userId === userId && !share.revokedAt
}

export function snapshotReferencesAttachment(snapshot: ChatShareSnapshot, attachmentId: string): boolean {
  return snapshot.attachments.some((attachment) => attachment.id === attachmentId)
}
