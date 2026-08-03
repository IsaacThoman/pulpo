import { describe, expect, it } from 'vitest'
import { hasMultipleBranches, withBranchMetadata } from './message-branches'

function response(id: string, userMessageId: string, createdAt = '2026-08-03T12:00:00.000Z') {
  return {
    id,
    parentResponseId: null,
    userMessageId,
    input: [{ role: 'user', content: userMessageId }],
    createdAt,
    branches: {
      user: { ids: [id], index: 0 },
      assistant: { ids: [id], index: 0 },
    },
  }
}

describe('message branches', () => {
  it('shows controls only when a message has sibling variants', () => {
    expect(hasMultipleBranches(undefined)).toBe(false)
    expect(hasMultipleBranches({ ids: ['one'], index: 0 })).toBe(false)
    expect(hasMultipleBranches({ ids: ['one', 'two'], index: 1 })).toBe(true)
  })

  it('orders simultaneous sibling generations deterministically by UUIDv7 id', () => {
    const annotated = withBranchMetadata([
      response('0198-0002', 'prompt-1'),
      response('0198-0001', 'prompt-1'),
    ])

    expect(annotated.map((item) => item.id)).toEqual(['0198-0001', '0198-0002'])
    expect(annotated[1]?.branches.assistant).toEqual({ ids: ['0198-0001', '0198-0002'], index: 1 })
  })

  it('separates edited prompts from regenerations of the same prompt', () => {
    const annotated = withBranchMetadata([
      response('answer-1', 'prompt-1', '2026-08-03T12:00:00.000Z'),
      response('answer-2', 'prompt-1', '2026-08-03T12:00:01.000Z'),
      response('edited', 'prompt-2', '2026-08-03T12:00:02.000Z'),
    ])

    expect(annotated[1]?.branches.assistant).toEqual({ ids: ['answer-1', 'answer-2'], index: 1 })
    expect(annotated[1]?.branches.user).toEqual({ ids: ['answer-2', 'edited'], index: 0 })
  })
})
