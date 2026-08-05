import { describe, expect, it } from 'vitest'
import { phaseAfterDisconnect, shouldShowConnectionBanner } from './realtimeConnection'

describe('mobile realtime connection presentation', () => {
  it('keeps initial and resume connections silent', () => {
    expect(phaseAfterDisconnect(false, true)).toBe('connecting')
    expect(phaseAfterDisconnect(true, false)).toBe('idle')
    expect(shouldShowConnectionBanner({ phase: 'connecting', offline: false, syncError: null })).toBe(false)
    expect(shouldShowConnectionBanner({ phase: 'idle', offline: false, syncError: null })).toBe(false)
  })

  it('shows a reconnect only after an active connection has synchronized', () => {
    expect(phaseAfterDisconnect(false, true)).toBe('connecting')
    expect(phaseAfterDisconnect(true, true, false)).toBe('connecting')
    expect(phaseAfterDisconnect(true, true)).toBe('reconnecting')
    expect(shouldShowConnectionBanner({ phase: 'reconnecting', offline: false, syncError: null })).toBe(true)
  })

  it('always surfaces confirmed offline state and actionable sync errors', () => {
    expect(shouldShowConnectionBanner({ phase: 'connecting', offline: true, syncError: null })).toBe(true)
    expect(shouldShowConnectionBanner({ phase: 'connecting', offline: false, syncError: 'Sync failed' })).toBe(true)
  })
})
