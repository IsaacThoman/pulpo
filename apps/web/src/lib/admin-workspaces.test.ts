import { describe, expect, it } from 'vitest'
import { formatWorkspaceDeadline, formatWorkspaceDuration, workspaceCount } from './admin-workspaces'

describe('admin workspace formatting', () => {
  it('formats compact elapsed durations', () => {
    expect(formatWorkspaceDuration(0)).toBe('now')
    expect(formatWorkspaceDuration(65_000)).toBe('1m 5s')
    expect(formatWorkspaceDuration(3_661_000)).toBe('1h 1m')
  })

  it('distinguishes upcoming and overdue deadlines', () => {
    const now = Date.parse('2026-08-16T12:00:00.000Z')
    expect(formatWorkspaceDeadline('2026-08-16T12:02:30.000Z', now)).toBe('2m 30s')
    expect(formatWorkspaceDeadline('2026-08-16T11:58:00.000Z', now)).toBe('2m 0s overdue')
    expect(formatWorkspaceDeadline(null, now)).toBe('—')
  })

  it('pluralizes workspace activity counts', () => {
    expect(workspaceCount(1, 'tool')).toBe('1 tool')
    expect(workspaceCount(2, 'tool')).toBe('2 tools')
  })
})
