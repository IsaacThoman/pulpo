import { describe, expect, it } from 'vitest'
import {
  chatKeyboardBlankSpace,
  chatLandingKeyboardTranslation,
  isNearChatBottom,
  resolveKeyboardLayoutProgress,
  shouldFollowChatContent,
} from './viewport'

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

  it('lets an explicit send override stale proximity without overriding the reader', () => {
    expect(shouldFollowChatContent(false, false, true)).toBe(true)
    expect(shouldFollowChatContent(false, true, true)).toBe(false)
  })

  it('freezes keyboard-responsive chat layout while another surface owns the keyboard', () => {
    expect(resolveKeyboardLayoutProgress(1, false)).toBe(0)
    expect(resolveKeyboardLayoutProgress(0.45, false)).toBe(0)
    expect(resolveKeyboardLayoutProgress(0.45, true)).toBe(0.45)
  })

  it('absorbs keyboard movement into unused space below short transcripts', () => {
    expect(chatKeyboardBlankSpace(800, 460)).toBe(340)
    expect(chatKeyboardBlankSpace(800, 800)).toBe(0)
    expect(chatKeyboardBlankSpace(800, 1200)).toBe(0)
  })

  it('waits for valid measurements before applying keyboard blank space', () => {
    expect(chatKeyboardBlankSpace(0, 460)).toBe(0)
    expect(chatKeyboardBlankSpace(800, 0)).toBe(0)
  })
})

describe('empty chat keyboard centering', () => {
  it('keeps equal space above and below the identity as different keyboards lift the composer', () => {
    const headerBottom = 100, restingComposerTop = 750
    const restingIdentityCenter = (headerBottom + restingComposerTop) / 2
    for (const keyboardHeight of [280, 360, 420]) {
      for (const progress of [0, 0.25, 0.5, 1]) {
        const composerOffset = 12
        const lift = -keyboardHeight * progress
        const center = restingIdentityCenter + chatLandingKeyboardTranslation(lift, progress, composerOffset, true)
        const composerTop = restingComposerTop + lift + progress * composerOffset
        expect(center - headerBottom).toBe(composerTop - center)
      }
    }
  })

  it('leaves background chat content in place when another surface owns the keyboard', () => {
    expect(chatLandingKeyboardTranslation(-360, 1, 12, false)).toBe(0)
  })

  it('does not shift down when a restored screen has no visible keyboard', () => {
    expect(chatLandingKeyboardTranslation(0, 0, 12, true)).toBe(0)
    expect(chatLandingKeyboardTranslation(0, 1, 12, true)).toBe(0)
  })
})
