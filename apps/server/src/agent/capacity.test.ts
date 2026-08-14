import { describe, expect, it } from 'vitest'
import { isCapacityReservationInvalidResponse, isCapacityReservationUnsupportedResponse, isWorkspaceCapacityResponse, workspaceContinueWithoutAgentAvailableAt, workspaceContinueWithoutAgentIsAvailable, workspaceQueuePosition } from './capacity.js'

describe('workspace capacity queue', () => {
  it('recognizes structured and legacy controller capacity responses as retryable', () => {
    expect(isWorkspaceCapacityResponse(503, '{"error":"full","code":"workspace_capacity_exhausted","scope":"instance"}')).toBe(true)
    expect(isWorkspaceCapacityResponse(503, '{"error":"full","code":"workspace_capacity_exhausted","scope":"controller"}')).toBe(true)
    expect(isWorkspaceCapacityResponse(503, '{"error":"Maximum active workspace capacity reached"}')).toBe(true)
    expect(isWorkspaceCapacityResponse(503, '{"error":"Maximum controller workspace capacity reached"}')).toBe(true)
    expect(isWorkspaceCapacityResponse(503, '{"error":"Kubernetes unavailable"}')).toBe(false)
    expect(isWorkspaceCapacityResponse(401, 'Maximum active workspace capacity reached')).toBe(false)
  })

  it('recognizes reservation compatibility and retry responses narrowly', () => {
    expect(isCapacityReservationUnsupportedResponse(404)).toBe(true)
    expect(isCapacityReservationUnsupportedResponse(503)).toBe(false)
    expect(isCapacityReservationInvalidResponse(409, '{"code":"workspace_capacity_reservation_invalid"}')).toBe(true)
    expect(isCapacityReservationInvalidResponse(409, '{"code":"other"}')).toBe(false)
    expect(isCapacityReservationInvalidResponse(503, '{"code":"workspace_capacity_reservation_invalid"}')).toBe(false)
  })

  it('uses stable one-based FIFO positions', () => {
    const queue = ['lease-a', 'lease-b', 'lease-c']
    expect(workspaceQueuePosition(queue, 'lease-a')).toBe(1)
    expect(workspaceQueuePosition(queue, 'lease-c')).toBe(3)
    expect(workspaceQueuePosition(queue, 'missing')).toBe(0)
  })

  it('uses the persisted queue creation time for continue eligibility', () => {
    const createdAt = new Date('2026-08-14T12:00:00.000Z')
    expect(workspaceContinueWithoutAgentAvailableAt(createdAt).toISOString())
      .toBe('2026-08-14T12:00:15.000Z')
    expect(workspaceContinueWithoutAgentIsAvailable(createdAt, Date.parse('2026-08-14T12:00:14.999Z'))).toBe(false)
    expect(workspaceContinueWithoutAgentIsAvailable(createdAt, Date.parse('2026-08-14T12:00:15.000Z'))).toBe(true)
  })
})
