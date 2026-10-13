import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Message, ToolCall, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai'
import {
  buildCompactedPiHistory,
  dropOldestPiUnit,
  piSummaryMessage,
  piUserMessageText,
  piUserTextMessage,
} from './pi-history.js'
import { LEGACY_SUMMARY_PREFIXES, SUMMARY_PREFIX, summaryMessageText } from './prompt.js'

function user(content: UserMessage['content']): UserMessage {
  return { role: 'user', content, timestamp: 1 }
}

function assistant(text: string, calls: string[] = []): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text },
      ...calls.map((id): ToolCall => ({ type: 'toolCall', id, name: 'tool', arguments: {} })),
    ],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-test',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: calls.length ? 'toolUse' : 'stop',
    timestamp: 1,
  }
}

function result(id: string): ToolResultMessage {
  return { role: 'toolResult', toolCallId: id, toolName: 'tool', content: [{ type: 'text', text: `result ${id}` }], isError: false, timestamp: 1 }
}

describe('piUserMessageText', () => {
  it('collects only user text and ignores assistant and tool messages', () => {
    expect(piUserMessageText(user('hello'))).toBe('hello')
    expect(piUserMessageText(assistant('answer'))).toBeUndefined()
    expect(piUserMessageText(result('a'))).toBeUndefined()
    expect(piUserMessageText({ role: 'custom', content: 'x' })).toBeUndefined()
    expect(piUserMessageText(undefined)).toBeUndefined()
  })

  it('joins text parts with no separator and drops images', () => {
    expect(piUserMessageText(user([
      { type: 'text', text: 'first' },
      { type: 'text', text: '' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'text', text: 'second' },
    ]))).toBe('firstsecond')
  })

  it('skips empty messages and summaries, new and legacy', () => {
    expect(piUserMessageText(user(''))).toBeUndefined()
    expect(piUserMessageText(user([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]))).toBeUndefined()
    expect(piUserMessageText(user(summaryMessageText('earlier work')))).toBeUndefined()
    for (const prefix of LEGACY_SUMMARY_PREFIXES) {
      expect(piUserMessageText(user([{ type: 'text', text: `${prefix}\nold summary` }]))).toBeUndefined()
    }
  })
})

describe('buildCompactedPiHistory', () => {
  it('keeps user messages and puts the summary last', () => {
    const messages: Message[] = [
      user('first'),
      assistant('a1', ['c1']),
      result('c1'),
      user([{ type: 'text', text: 'second' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }]),
      assistant('a2'),
    ]
    const compacted = buildCompactedPiHistory(messages, 'the summary', 20_000)
    expect(compacted.retained).toEqual([{ text: 'first', truncated: false }, { text: 'second', truncated: false }])
    expect(compacted.messages.map((message) => message.role)).toEqual(['user', 'user', 'user'])
    expect(compacted.messages.map(piUserMessageText)).toEqual(['first', 'second', undefined])
    expect(compacted.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: `${SUMMARY_PREFIX}\nthe summary` }] })
  })

  it('never retains earlier summaries', () => {
    const messages = [user('kept'), piSummaryMessage('old summary'), user('[Compacted context]\nolder summary'), user('latest')]
    const compacted = buildCompactedPiHistory(messages, 'new summary', 20_000)
    expect(compacted.retained.map((message) => message.text)).toEqual(['kept', 'latest'])
    expect(compacted.messages).toHaveLength(3)
  })

  it('truncates the boundary message within the budget', () => {
    const compacted = buildCompactedPiHistory([user('word '.repeat(200)), user('recent')], 'summary', 16)
    expect(compacted.retained).toHaveLength(2)
    expect(compacted.retained[0]!.truncated).toBe(true)
    expect(piUserMessageText(compacted.messages[0])).toContain('tokens truncated')
    expect(compacted.messages).toHaveLength(3)
  })

  it('keeps only the summary with no budget', () => {
    expect(buildCompactedPiHistory([user('one')], 'summary', 0).messages).toEqual([piSummaryMessage('summary', expect.any(Number))])
  })
})

describe('piUserTextMessage', () => {
  it('builds a text-only user message', () => {
    expect(piUserTextMessage('hi', 5)).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 5 })
    expect(piSummaryMessage(' summary \n', 5)).toEqual(piUserTextMessage(`${SUMMARY_PREFIX}\nsummary`, 5))
  })
})

describe('dropOldestPiUnit', () => {
  it('keeps a leading user message and drops the next unit', () => {
    const messages: Message[] = [user('task'), user('more'), assistant('done')]
    expect(dropOldestPiUnit(messages)).toEqual([user('task'), assistant('done')])
  })

  it('drops an assistant message with every tool result answering it', () => {
    const messages: Message[] = [user('task'), assistant('a1', ['c1', 'c2']), result('c1'), result('c2'), assistant('a2', ['c3']), result('c3')]
    expect(dropOldestPiUnit(messages)).toEqual([user('task'), assistant('a2', ['c3']), result('c3')])
  })

  it('drops the matching tool call when a tool result is dropped first', () => {
    const messages: Message[] = [result('c1'), assistant('a1', ['c1', 'c2']), result('c2')]
    const [, partial] = messages
    expect(dropOldestPiUnit(messages)).toEqual([{ ...partial, content: [(partial as AssistantMessage).content[0], (partial as AssistantMessage).content[2]] }, result('c2')])
    expect(dropOldestPiUnit([result('c1'), { ...assistant('a1', ['c1']), content: [{ type: 'toolCall', id: 'c1', name: 'tool', arguments: {} }] }]))
      .toEqual([])
  })

  it('never leaves orphaned tool results', () => {
    const messages: Message[] = [user('task'), user('extra'), result('lost'), assistant('a1', ['c1']), result('c1')]
    const next = dropOldestPiUnit(messages)!
    expect(next).toEqual([user('task'), assistant('a1', ['c1']), result('c1')])
    const calls = new Set(next.flatMap((message) => message.role === 'assistant' ? message.content.flatMap((part) => part.type === 'toolCall' ? [part.id] : []) : []))
    expect(next.every((message) => message.role !== 'toolResult' || calls.has(message.toolCallId))).toBe(true)
  })

  it('drops from the start when the history opens with an assistant message', () => {
    expect(dropOldestPiUnit([assistant('a1', ['c1']), result('c1'), user('next')])).toEqual([user('next')])
  })

  it('drops the protected first user message once it is all that remains', () => {
    // An oversized first message must still be droppable, or its chat could never compact.
    expect(dropOldestPiUnit([user('task')])).toEqual([])
    expect(dropOldestPiUnit([assistant('only')])).toEqual([])
    expect(dropOldestPiUnit([user('task'), result('lost')])).toEqual([user('task')])
  })

  it('returns undefined only for an empty history', () => {
    expect(dropOldestPiUnit([])).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const messages: Message[] = [result('c1'), assistant('a1', ['c1', 'c2']), result('c2')]
    const snapshot = structuredClone(messages)
    dropOldestPiUnit(messages)
    expect(messages).toEqual(snapshot)
  })

  it('shrinks the history by one unit at a time, dropping the protected message last', () => {
    let history: Message[] | undefined = [user('task'), assistant('a1', ['c1']), result('c1'), user('two'), assistant('a2')]
    const lengths: number[] = []
    while (history) {
      lengths.push(history.length)
      history = dropOldestPiUnit(history)
    }
    expect(lengths).toEqual([5, 3, 2, 1, 0])
  })
})
