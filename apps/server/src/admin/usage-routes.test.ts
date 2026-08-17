import { describe, expect, it } from 'vitest'
import {
  ADMIN_USAGE_PAYLOAD_REVEAL_PATH,
  adminUsagePayloadAudit,
  adminUsagePayloadStatus,
  decodeAdminUsageCursor,
  encodeAdminUsageCursor,
  reconcileAdminUsageCosts,
} from './usage-routes.js'

describe('admin request usage helpers', () => {
  it('round trips stable timestamp and id cursors', () => {
    const value = { createdAt: new Date('2026-08-16T12:00:00.000Z'), id: '00000000-0000-4000-8000-000000000001' }
    expect(decodeAdminUsageCursor(encodeAdminUsageCursor(value))).toEqual(value)
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeAdminUsageCursor('not-a-cursor')).toThrow('Usage cursor is invalid')
  })

  it('reconciles billed model and tool costs without mixing in provider cost', () => {
    expect(reconcileAdminUsageCosts({
      requestCostMicros: 75_000,
      attempts: [{ costMicros: 20_000 }, { costMicros: 30_000 }],
      tools: [{ billedCostMicros: 15_000, providerCostMicros: 9_000 }],
    })).toEqual({
      requestCostMicros: 75_000,
      modelCostMicros: 50_000,
      toolBilledCostMicros: 15_000,
      toolProviderCostMicros: 9_000,
      remainderMicros: 10_000,
    })
  })

  it('distinguishes available, absent, and expired payloads', () => {
    const now = Date.parse('2026-08-16T12:00:00.000Z')
    expect(adminUsagePayloadStatus({ input: [] }, null, now)).toBe('available')
    expect(adminUsagePayloadStatus(null, null, now)).toBe('not_stored')
    expect(adminUsagePayloadStatus({ input: [] }, new Date(now - 1), now)).toBe('expired')
  })

  it('keeps payload reveal outside the management usage proxy prefix', () => {
    expect(ADMIN_USAGE_PAYLOAD_REVEAL_PATH.startsWith('/api/admin/usage/')).toBe(false)
  })

  it('records the actor, request, response, scope, and resource for every successful reveal', () => {
    const event = adminUsagePayloadAudit({
      actorUserId: '00000000-0000-4000-8000-000000000001',
      requestId: '00000000-0000-4000-8000-000000000002',
      responseId: '00000000-0000-4000-8000-000000000003',
      scope: 'tool_output', resourceId: '00000000-0000-4000-8000-000000000004',
      payloadExpiresAt: new Date('2026-08-16T12:00:00.000Z'),
    })
    expect(event).toMatchObject({
      actorUserId: '00000000-0000-4000-8000-000000000001', action: 'usage.payload.reveal',
      targetType: 'request_log', targetId: '00000000-0000-4000-8000-000000000002',
      metadata: {
        responseId: '00000000-0000-4000-8000-000000000003', scope: 'tool_output',
        resourceId: '00000000-0000-4000-8000-000000000004', payloadExpiresAt: '2026-08-16T12:00:00.000Z',
      },
    })
  })
})
