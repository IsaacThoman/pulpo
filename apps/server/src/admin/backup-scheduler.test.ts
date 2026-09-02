import { describe, expect, it } from 'vitest'
import { nextScheduledRun } from './backup-scheduler.js'

describe('offsite backup scheduling', () => {
  it('preserves interval slots after downtime and schedules one future run', () => {
    const due = new Date('2026-09-01T00:00:00.000Z')
    const now = new Date('2026-09-02T07:00:00.000Z')
    expect(nextScheduledRun(due, now, 6).toISOString()).toBe('2026-09-02T12:00:00.000Z')
    expect(nextScheduledRun(due, now, 12).toISOString()).toBe('2026-09-02T12:00:00.000Z')
    expect(nextScheduledRun(due, now, 24).toISOString()).toBe('2026-09-03T00:00:00.000Z')
  })
})

