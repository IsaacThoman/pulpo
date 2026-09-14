import { describe, expect, it, vi } from 'vitest'
import { toolApprovalRequired } from '@pulpo/contracts'

const state = vi.hoisted(() => ({ loaded: undefined as unknown }))
vi.mock('../../database/client.js', () => ({ db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => state.loaded ? [state.loaded] : [] }) }) }) }) } }))
vi.mock('../../redis.js', () => ({ redis: {}, createRedis: () => ({}) }))

import { verifyToolApproval, serializeToolApproval, toolApprovalItem, toolApprovalSummary, type ApprovalRow } from './approvals.js'

const row: ApprovalRow = {
  id: '11111111-1111-4111-8111-111111111111',
  responseId: '22222222-2222-4222-8222-222222222222',
  agentRunId: '33333333-3333-4333-8333-333333333333',
  computerId: '44444444-4444-4444-8444-444444444444',
  operationId: 'call_1',
  actionDigest: null,
  kind: 'bash',
  summary: 'rm -rf build',
  status: 'pending',
  decidedBySessionId: null,
  decidedVia: null,
  decidedAt: null,
  expiresAt: new Date('2026-09-13T12:05:00.000Z'),
  createdAt: new Date('2026-09-13T12:00:00.000Z'),
  updatedAt: new Date('2026-09-13T12:00:00.000Z'),
}

describe('tool approvals', () => {
  it('gates by policy: default covers commands and file changes, bash-only just commands, never nothing', () => {
    expect(['bash', 'write', 'edit', 'read', 'list'].filter((kind) => toolApprovalRequired(kind, 'default'))).toEqual(['bash', 'write', 'edit'])
    expect(['bash', 'write', 'edit', 'read'].filter((kind) => toolApprovalRequired(kind, 'bash-only'))).toEqual(['bash'])
    expect(['bash', 'write', 'edit'].some((kind) => toolApprovalRequired(kind, 'never'))).toBe(false)
  })

  it('summarizes what the user is approving and truncates very long commands', () => {
    expect(toolApprovalSummary('bash', { command: 'git status' })).toBe('git status')
    expect(toolApprovalSummary('write', { path: 'notes.md', content: 'x'.repeat(5_000) })).toBe('notes.md')
    const long = toolApprovalSummary('bash', { command: 'a'.repeat(3_000) })
    expect(long.length).toBe(2_001)
    expect(long.endsWith('…')).toBe(true)
  })

  it('renders the timeline item and REST shape from a row', () => {
    expect(toolApprovalItem(row, 'Studio')).toEqual({
      id: row.id, type: 'pulpo_approval', tool_call_id: 'call_1', kind: 'bash', summary: 'rm -rf build', status: 'pending',
      computer_name: 'Studio', expires_at: '2026-09-13T12:05:00.000Z',
    })
    const decided = { ...row, status: 'denied', decidedVia: 'desktop', decidedAt: new Date('2026-09-13T12:01:00.000Z') }
    expect(toolApprovalItem(decided, 'Studio')).toMatchObject({ status: 'denied', decided_via: 'desktop', decided_at: '2026-09-13T12:01:00.000Z' })
    expect(serializeToolApproval(decided, 'Studio', '55555555-5555-4555-8555-555555555555')).toMatchObject({
      id: row.id, chatId: '55555555-5555-4555-8555-555555555555', computerName: 'Studio', toolCallId: 'call_1', status: 'denied', decidedVia: 'desktop',
    })
  })
  it('requires a durable approved record bound to the chat, operation and full payload digest', async () => {
    const input = { approvalId: row.id, chatId: 'chat', operationId: row.operationId, digest: 'original' }
    state.loaded = { approval: { ...row, status: 'approved', actionDigest: 'original' }, chatId: 'chat' }
    expect(await verifyToolApproval(row.computerId, input)).toBe(true)
    for (const patch of [{ chatId: 'different' }, { operationId: 'different' }, { digest: 'modified' }]) {
      expect(await verifyToolApproval(row.computerId, { ...input, ...patch })).toBe(false)
    }
    state.loaded = { approval: { ...row, status: 'pending', actionDigest: 'original' }, chatId: 'chat' }
    expect(await verifyToolApproval(row.computerId, input)).toBe(false)
    state.loaded = undefined
    expect(await verifyToolApproval(row.computerId, input)).toBe(false)
  })

})
