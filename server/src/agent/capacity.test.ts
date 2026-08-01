import { describe, expect, it } from 'vitest'
import { isWorkspaceCapacityResponse, workspaceQueuePosition } from './capacity.js'

describe('workspace capacity queue', () => {
  it('recognizes only the controller capacity response as retryable', () => {
    expect(isWorkspaceCapacityResponse(503, '{"error":"Maximum active workspace capacity reached"}')).toBe(true)
    expect(isWorkspaceCapacityResponse(503, '{"error":"Kubernetes unavailable"}')).toBe(false)
    expect(isWorkspaceCapacityResponse(401, 'Maximum active workspace capacity reached')).toBe(false)
  })

  it('uses stable one-based FIFO positions', () => {
    const queue = ['lease-a', 'lease-b', 'lease-c']
    expect(workspaceQueuePosition(queue, 'lease-a')).toBe(1)
    expect(workspaceQueuePosition(queue, 'lease-c')).toBe(3)
    expect(workspaceQueuePosition(queue, 'missing')).toBe(0)
  })
})
