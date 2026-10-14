import { describe, expect, it } from 'vitest'
import { selectRetainedUserMessages } from './retained-user-messages.js'

describe('selectRetainedUserMessages', () => {
  it('keeps every message that fits, in chronological order', () => {
    expect(selectRetainedUserMessages(['first', 'second', 'third'], 100)).toEqual([
      { text: 'first', truncated: false },
      { text: 'second', truncated: false },
      { text: 'third', truncated: false },
    ])
  })

  it('selects newest first and truncates the boundary message, then stops', () => {
    // 'newest' (2 tokens) and 'middle' (2 tokens) fit in 6; 'word ' x 200 gets the last 2 tokens.
    const result = selectRetainedUserMessages(['oldest', 'word '.repeat(200), 'middle', 'newest'], 6)
    expect(result).toHaveLength(3)
    expect(result[0]!.truncated).toBe(true)
    expect(result[0]!.text).toContain('tokens truncated')
    expect(result.slice(1)).toEqual([
      { text: 'middle', truncated: false },
      { text: 'newest', truncated: false },
    ])
  })

  it('truncates a single oversized message to the budget (Codex budget 16 pin)', () => {
    const result = selectRetainedUserMessages(['word '.repeat(200)], 16)
    expect(result).toHaveLength(1)
    expect(result[0]!.truncated).toBe(true)
    expect(result[0]!.text).toContain('tokens truncated')
  })

  it('stops once the budget is exactly used up', () => {
    // 'abcd' and 'efgh' are one token each.
    expect(selectRetainedUserMessages(['older', 'abcd', 'efgh'], 2)).toEqual([
      { text: 'abcd', truncated: false },
      { text: 'efgh', truncated: false },
    ])
  })

  it('skips empty and whitespace-only messages', () => {
    expect(selectRetainedUserMessages(['keep', '', '   \n'], 10)).toEqual([{ text: 'keep', truncated: false }])
  })

  it('keeps nothing with a zero budget', () => {
    expect(selectRetainedUserMessages(['one', 'two'], 0)).toEqual([])
    expect(selectRetainedUserMessages([], 100)).toEqual([])
  })
})
