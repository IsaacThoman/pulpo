import { describe, expect, it } from 'vitest'
import { splitCodexConversationExchanges } from './codex-compaction.js'

describe('Codex conversation compaction', () => {
  it('retains exactly the configured complete exchanges', () => {
    const result = splitCodexConversationExchanges([
      { responseId: 'one', messages: ['user one', 'assistant one'] },
      { responseId: 'two', messages: ['user two', 'assistant two'] },
      { responseId: 'three', messages: ['user three', 'assistant three'] },
    ], 2)
    expect(result.older).toEqual(['user one', 'assistant one'])
    expect(result.retainedExchanges).toEqual([
      ['user two', 'assistant two'],
      ['user three', 'assistant three'],
    ])
    expect(result.retained).toEqual(['user two', 'assistant two', 'user three', 'assistant three'])
    expect(result.coveredThroughResponseId).toBe('one')
  })
})
