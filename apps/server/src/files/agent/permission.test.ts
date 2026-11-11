import { describe, expect, it, vi } from 'vitest'

vi.mock('../../redis.js', () => ({ redis: {} }))

const { filesPermissionItemId, filesPermissionRequest, waitForFilesPermissionDecision } = await import('./permission.js')

function answers(values: Array<string | null>) {
  const cleared = vi.fn()
  return { cleared, store: { read: vi.fn(async () => values.shift() ?? null), clear: cleared } }
}

describe('Files permission requests', () => {
  it('describes a request that expires after the timeout', () => {
    const now = new Date('2026-11-09T10:00:00.000Z')
    expect(filesPermissionRequest({ responseId: 'r', ordinal: 2, command: 'ls', path: '', agentTurn: 3, now, timeoutMs: 60_000 })).toEqual({
      id: filesPermissionItemId('r', 2), type: 'pulpo_files_permission', status: 'awaiting_decision', command: 'ls', path: '',
      requested_at: '2026-11-09T10:00:00.000Z', expires_at: '2026-11-09T10:01:00.000Z', agent_turn: 3,
    })
  })

  it('returns the recorded answer and clears it', async () => {
    const { store, cleared } = answers([null, 'nonsense', 'allow_chat'])
    await expect(waitForFilesPermissionDecision({ answers: store, expiresAt: new Date(Date.now() + 5_000), pollMs: 1 })).resolves.toBe('allow_chat')
    expect(cleared).toHaveBeenCalledOnce()
  })

  it('expires without an answer and stops when the run is aborted', async () => {
    await expect(waitForFilesPermissionDecision({ answers: answers([]).store, expiresAt: new Date(Date.now() + 20), pollMs: 5 })).resolves.toBe('expired')
    const controller = new AbortController()
    const waiting = waitForFilesPermissionDecision({ answers: answers([]).store, expiresAt: new Date(Date.now() + 60_000), signal: controller.signal, pollMs: 10_000 })
    controller.abort()
    await expect(waiting).resolves.toBe('stopped')
  })
})
