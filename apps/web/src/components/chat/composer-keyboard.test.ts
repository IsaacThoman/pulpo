import { describe, expect, it } from 'vitest'
import { shouldSubmitComposerKey } from './composer-keyboard'

function keyEvent(overrides: Partial<Parameters<typeof shouldSubmitComposerKey>[0]> = {}) {
  return {
    key: 'Enter',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  }
}

describe('composer keyboard submission', () => {
  it('submits with plain Enter when the preference is enabled', () => {
    expect(shouldSubmitComposerKey(keyEvent(), true)).toBe(true)
  })

  it('leaves plain Enter available for newlines when the preference is disabled', () => {
    expect(shouldSubmitComposerKey(keyEvent(), false)).toBe(false)
  })

  it('submits with Cmd+Enter or Ctrl+Enter when the preference is disabled', () => {
    expect(shouldSubmitComposerKey(keyEvent({ metaKey: true }), false)).toBe(true)
    expect(shouldSubmitComposerKey(keyEvent({ ctrlKey: true }), false)).toBe(true)
  })

  it('uses Shift+Enter for a newline when the preference is enabled', () => {
    expect(shouldSubmitComposerKey(keyEvent({ shiftKey: true }), true)).toBe(false)
  })

  it('does not submit while text composition is active', () => {
    expect(shouldSubmitComposerKey(keyEvent({ metaKey: true, isComposing: true }), true)).toBe(false)
  })
})
