import { describe, expect, it } from 'vitest'
import { canSubmitMessageEdit } from './message-edit'

describe('message edit submission', () => {
  it('allows a user message to be resubmitted without changing its text', () => {
    expect(canSubmitMessageEdit({
      role: 'user',
      draft: 'Same prompt',
      originalContent: 'Same prompt',
      hasAttachments: false,
    })).toBe(true)
  })

  it('requires text or an existing attachment for user messages', () => {
    expect(canSubmitMessageEdit({
      role: 'user',
      draft: '   ',
      originalContent: '',
      hasAttachments: false,
    })).toBe(false)
    expect(canSubmitMessageEdit({
      role: 'user',
      draft: '   ',
      originalContent: '',
      hasAttachments: true,
    })).toBe(true)
  })

  it('continues to reject empty or unchanged assistant edits', () => {
    expect(canSubmitMessageEdit({
      role: 'assistant',
      draft: 'Same response',
      originalContent: 'Same response',
      hasAttachments: false,
    })).toBe(false)
    expect(canSubmitMessageEdit({
      role: 'assistant',
      draft: '   ',
      originalContent: 'Same response',
      hasAttachments: false,
    })).toBe(false)
  })
})
