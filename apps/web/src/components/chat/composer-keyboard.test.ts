import { describe, expect, it } from 'vitest'
import { shouldSubmitComposerKey } from './composer-keyboard'

function keyEvent(overrides: Partial<Parameters<typeof shouldSubmitComposerKey>[0]> = {}) {
  return {
    key: 'Enter',
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    ...overrides,
  }
}

describe('composer keyboard submission', () => {
  it('leaves plain Enter available for newlines', () => {
    expect(shouldSubmitComposerKey(keyEvent())).toBe(false)
  })

  it('submits with Cmd+Enter or Ctrl+Enter', () => {
    expect(shouldSubmitComposerKey(keyEvent({ metaKey: true }))).toBe(true)
    expect(shouldSubmitComposerKey(keyEvent({ ctrlKey: true }))).toBe(true)
  })

  it('does not submit while text composition is active', () => {
    expect(shouldSubmitComposerKey(keyEvent({ metaKey: true, isComposing: true }))).toBe(false)
  })
})
