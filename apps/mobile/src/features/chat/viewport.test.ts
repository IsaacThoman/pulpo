import { describe, expect, it } from 'vitest'
import { isNearChatBottom, resolveKeyboardLayoutProgress, shouldFollowChatContent } from './viewport'

describe('chat viewport following', () => {
  it('follows short transcripts and readers already near the end', () => {
    expect(isNearChatBottom({ offsetY: 0, contentHeight: 500, viewportHeight: 700 })).toBe(true)
    expect(isNearChatBottom({ offsetY: 1210, contentHeight: 2000, viewportHeight: 700 })).toBe(true)
  })

  it('does not pull a reader back after they move away from the end', () => {
    expect(isNearChatBottom({ offsetY: 900, contentHeight: 2000, viewportHeight: 700 })).toBe(false)
  })

  it('pauses following as soon as a drag or momentum sequence begins', () => {
    expect(shouldFollowChatContent(true, true)).toBe(false)
    expect(shouldFollowChatContent(true, false)).toBe(true)
    expect(shouldFollowChatContent(false, false)).toBe(false)
  })

  it('freezes keyboard-responsive chat layout while another surface owns the keyboard', () => {
    expect(resolveKeyboardLayoutProgress(1, false)).toBe(0)
    expect(resolveKeyboardLayoutProgress(0.45, false)).toBe(0)
    expect(resolveKeyboardLayoutProgress(0.45, true)).toBe(0.45)
  })
})
