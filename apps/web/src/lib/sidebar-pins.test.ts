import { describe, expect, it } from 'vitest'
import { DEFAULT_SIDEBAR_PINS, normalizeSidebarPins, toggleSidebarPin } from './sidebar-pins'

describe('sidebar pins', () => {
  it('toggles only the selected link', () => {
    const pins = { ...DEFAULT_SIDEBAR_PINS, usage: true, friends: true }
    expect(toggleSidebarPin(pins, 'billing')).toEqual({ ...pins, billing: true })
    expect(pins.billing).toBe(false)
  })

  it('keeps Search chats and Files visible for preferences saved before they were hideable', () => {
    expect(normalizeSidebarPins({ usage: true, billing: false, friends: false, apiKeys: false }))
      .toEqual({ searchChats: true, files: true, usage: true, billing: false, friends: false, apiKeys: false })
    expect(normalizeSidebarPins({ ...DEFAULT_SIDEBAR_PINS, files: false }).files).toBe(false)
    expect(normalizeSidebarPins('garbage')).toEqual(DEFAULT_SIDEBAR_PINS)
  })
})
