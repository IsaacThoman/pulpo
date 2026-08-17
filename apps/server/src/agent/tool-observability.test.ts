import { describe, expect, it } from 'vitest'
import { toolExecutionObservability } from './tool-observability.js'

describe('agent tool observability', () => {
  it('records the invoking turn and start time for new tool executions', () => {
    const startedAt = new Date('2026-08-16T12:00:00.000Z')
    expect(toolExecutionObservability(3, startedAt)).toEqual({ turnNumber: 3, startedAt })
  })
})
