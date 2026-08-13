import { describe, expect, it } from 'vitest'
import { toggleSidebarPin } from './sidebar-pins'

describe('sidebar pins', () => {
  it('toggles only the selected link', () => {
    const pins = { usage: true, friends: true, apiKeys: false }
    expect(toggleSidebarPin(pins, 'friends')).toEqual({ usage: true, friends: false, apiKeys: false })
    expect(pins).toEqual({ usage: true, friends: true, apiKeys: false })
  })
})
