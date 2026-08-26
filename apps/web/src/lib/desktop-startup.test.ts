import { describe, expect, it } from 'vitest'
import { desktopStartupSurface } from './desktop-startup'

describe('desktop cached-first startup', () => {
  it('renders cached UI while the saved session is checked', () => {
    const state = { desktop: true, hasCachedUser: true, checkingSession: true, instanceReady: false }

    expect(desktopStartupSurface(state)).toBe('app')
  })

  it('keeps cached UI available when the instance is offline', () => {
    const state = { desktop: true, hasCachedUser: true, checkingSession: false, instanceReady: false }

    expect(desktopStartupSurface(state)).toBe('app')
  })

  it('blocks startup when no authenticated cache is available', () => {
    expect(desktopStartupSurface({
      desktop: true, hasCachedUser: false, checkingSession: true, instanceReady: false,
    })).toBe('connecting')
    expect(desktopStartupSurface({
      desktop: true, hasCachedUser: false, checkingSession: false, instanceReady: false,
    })).toBe('instance')
  })
})
