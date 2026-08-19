import { describe, expect, it } from 'vitest'
import { toggleSidebarPin } from './sidebar-pins'

describe('sidebar pins', () => {
  it('toggles only the selected link', () => {
    const pins = { usage: true, billing: false, friends: true, apiKeys: false }
    expect(toggleSidebarPin(pins, 'billing')).toEqual({ usage: true, billing: true, friends: true, apiKeys: false })
    expect(pins).toEqual({ usage: true, billing: false, friends: true, apiKeys: false })
  })
})
