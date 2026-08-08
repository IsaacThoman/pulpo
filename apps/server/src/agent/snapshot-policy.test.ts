import { describe, expect, it } from 'vitest'
import { agentSnapshotIsDue } from './snapshot-policy.js'

describe('agent snapshot publication policy', () => {
  it('publishes an initial checkpoint and then bounds checkpoints by interval', () => {
    expect(agentSnapshotIsDue(0, 100, 1_500)).toBe(true)
    expect(agentSnapshotIsDue(100, 1_599, 1_500)).toBe(false)
    expect(agentSnapshotIsDue(100, 1_600, 1_500)).toBe(true)
  })
})
