import { describe, expect, it } from 'vitest'
import {
  attachmentSendPolicy,
  cleanupServerIdOnRemoval,
  settleUploadFailure,
  settleUploadSuccess,
  startUploadAttempt,
  type CoordinatedUpload,
} from './attachmentUploadCoordinator'

function item(patch: Partial<CoordinatedUpload> = {}): CoordinatedUpload {
  return {
    localId: 'local-1', ownerId: 'draft-1', attempt: 0, managed: true, state: 'local', ...patch,
  }
}

describe('attachment upload coordinator', () => {
  it('increments attempts and clears retry errors', () => {
    expect(startUploadAttempt(item({ attempt: 2, state: 'failed', error: 'offline' }))).toEqual(
      item({ attempt: 3, state: 'uploading', error: undefined }),
    )
  })

  it('applies only the current completion', () => {
    const attempted = startUploadAttempt(item())
    expect(settleUploadSuccess({ attempted, current: attempted, serverId: 'server-1' })).toEqual({
      disposition: 'apply',
      item: item({ attempt: 1, state: 'ready', serverId: 'server-1' }),
    })
  })

  it('cleans remote reservations from cancelled, replaced, and stale attempts', () => {
    const attempted = startUploadAttempt(item())
    expect(settleUploadSuccess({ attempted, current: undefined, serverId: 'removed' })).toEqual({
      disposition: 'cleanup', serverId: 'removed',
    })
    expect(settleUploadSuccess({
      attempted,
      current: item({ ownerId: 'draft-2', attempt: 1, state: 'uploading' }),
      serverId: 'replaced',
    })).toEqual({ disposition: 'cleanup', serverId: 'replaced' })
    expect(settleUploadSuccess({
      attempted,
      current: item({ attempt: 2, state: 'uploading' }),
      serverId: 'stale',
    })).toEqual({ disposition: 'cleanup', serverId: 'stale' })
  })

  it('ignores stale failures after a retry begins', () => {
    const attempted = startUploadAttempt(item())
    const retrying = item({ attempt: 2, state: 'uploading' })
    expect(settleUploadFailure({ attempted, current: retrying, error: 'old failure' })).toBe(retrying)
  })

  it('allows optimistic sends during uploads but keeps edits atomic', () => {
    const uploading = [item({ state: 'uploading' })]
    expect(attachmentSendPolicy(uploading, { editing: false })).toEqual({ allowed: true })
    expect(attachmentSendPolicy(uploading, { editing: true })).toEqual({ allowed: false, reason: 'uploading' })
    expect(attachmentSendPolicy([item({ state: 'failed' })], { editing: false })).toEqual({ allowed: false, reason: 'failed' })
  })

  it('cleans only newly managed and unreferenced uploads', () => {
    expect(cleanupServerIdOnRemoval(item({ serverId: 'new' }))).toBe('new')
    expect(cleanupServerIdOnRemoval(item({ serverId: 'sent', managed: false }))).toBeUndefined()
    expect(cleanupServerIdOnRemoval(item({ serverId: 'original' }), new Set(['original']))).toBeUndefined()
  })
})
