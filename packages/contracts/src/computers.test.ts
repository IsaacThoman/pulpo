import { describe, expect, it } from 'vitest'
import {
  applyResponseEventToSnapshot, computerAnnounceSchema, createChatResponseSchema, toolApprovalItemSchema, toolApprovalRequired, workspaceSelectionSchema,
  type ResponseEvent, type ResponseSnapshot,
} from './index.js'

const snapshot: ResponseSnapshot = {
  responseId: '11111111-1111-4111-8111-111111111111', chatId: '22222222-2222-4222-8222-222222222222', status: 'in_progress', sequence: 1,
  output: [], usage: null, error: null, updatedAt: '2026-09-13T12:00:00.000Z',
} as unknown as ResponseSnapshot

function event(sequence: number, type: string, payload: Record<string, unknown>): ResponseEvent {
  return { responseId: snapshot.responseId, sequence, type, payload, emittedAt: '2026-09-13T12:00:01.000Z' } as unknown as ResponseEvent
}

describe('computer contracts', () => {
  it('upserts approval items by id as they move from pending to decided', () => {
    const approval = {
      id: '33333333-3333-4333-8333-333333333333', type: 'pulpo_approval', tool_call_id: 'call_1', kind: 'bash', summary: 'ls',
      status: 'pending', computer_name: 'Studio', expires_at: '2026-09-13T12:05:00.000Z',
    }
    const requested = applyResponseEventToSnapshot(snapshot, event(2, 'pulpo.agent.approval.requested', approval))
    expect(requested.output).toEqual([approval])
    const approved = applyResponseEventToSnapshot(requested, event(3, 'pulpo.agent.approval.approved', { ...approval, status: 'approved', decided_via: 'desktop' }))
    expect(approved.output).toHaveLength(1)
    expect(approved.output[0]).toMatchObject({ status: 'approved', decided_via: 'desktop' })
    expect(toolApprovalItemSchema.safeParse(approved.output[0]).success).toBe(true)
  })

  it('accepts an optional workspace selection on new responses', () => {
    const base = { input: 'hi', modelId: 'm', agentMode: true }
    expect(createChatResponseSchema.parse(base).workspace).toBeUndefined()
    expect(createChatResponseSchema.parse({ ...base, workspace: { kind: 'sandbox' } }).workspace).toEqual({ kind: 'sandbox' })
    expect(createChatResponseSchema.parse({ ...base, workspace: { kind: 'computer', computerId: '44444444-4444-4444-8444-444444444444' } }).workspace)
      .toEqual({ kind: 'computer', computerId: '44444444-4444-4444-8444-444444444444' })
    expect(workspaceSelectionSchema.safeParse({ kind: 'computer' }).success).toBe(false)
  })

  it('validates desktop announcements strictly', () => {
    const announce = {
      computerId: '44444444-4444-4444-8444-444444444444', name: 'Studio', os: 'macos', arch: 'arm64', appVersion: '1.2.3', accessMode: 'folder',
      rootPath: '/Users/me/site', attachmentsDir: '/Users/me/Library/Pulpo/attachments', homeDir: '/Users/me', shell: 'bash', approvalPolicy: 'default', allowRemote: false,
    }
    expect(computerAnnounceSchema.safeParse(announce).success).toBe(true)
    expect(computerAnnounceSchema.safeParse({ ...announce, os: 'beos' }).success).toBe(false)
    expect(computerAnnounceSchema.safeParse({ ...announce, rootPath: '' }).success).toBe(false)
  })

  it('applies approval policies per tool kind', () => {
    expect(toolApprovalRequired('write', 'default')).toBe(true)
    expect(toolApprovalRequired('write', 'bash-only')).toBe(false)
    expect(toolApprovalRequired('bash', 'never')).toBe(false)
  })
})
