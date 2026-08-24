import { describe, expect, it } from 'vitest'
import { chatSearchSnippet, chatSearchTsQuery } from './search.js'

describe('chat search', () => {
  it('builds a safe prefix query from user text', () => {
    expect(chatSearchTsQuery(' Authentication, mobile! ')).toBe('authentication:* & mobile:*')
    expect(chatSearchTsQuery(' -- ')).toBe('')
  })

  it('returns a compact visible-message snippet around the match', () => {
    const prefix = 'Earlier context '.repeat(12)
    const snippet = chatSearchSnippet(
      [{ role: 'user', content: `${prefix}mobile authentication details` }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'Use a passkey.' }] }],
      'authentication',
    )
    expect(snippet).toContain('authentication')
    expect(snippet).not.toContain('role')
    expect(snippet?.startsWith('…')).toBe(true)
    expect(snippet?.length).toBeLessThanOrEqual(182)
  })
})
