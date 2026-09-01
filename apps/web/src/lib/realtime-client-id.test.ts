// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('web realtime client identity', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.resetModules()
  })

  it('survives composer remounts for the lifetime of the tab', async () => {
    const { webRealtimeClientId } = await import('./realtime-client-id')
    const first = webRealtimeClientId()
    expect(webRealtimeClientId()).toBe(first)
    expect(sessionStorage.getItem('pulpo-tab-id')).toBe(first)
  })
})
