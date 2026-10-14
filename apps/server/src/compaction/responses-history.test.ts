import { describe, expect, it } from 'vitest'
import {
  buildCompactedResponsesHistory,
  dropOldestResponsesUnit,
  responsesSummaryItem,
  responsesUserText,
  responsesUserTextItem,
} from './responses-history.js'
import { LEGACY_SUMMARY_PREFIXES, SUMMARY_PREFIX, summaryMessageText } from './prompt.js'

const user = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] })
const assistant = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const reasoning = (id: string) => ({ type: 'reasoning', id, summary: [] })
const call = (id: string) => ({ type: 'function_call', call_id: id, name: 'tool', arguments: '{}' })
const output = (id: string) => ({ type: 'function_call_output', call_id: id, output: 'ok' })

describe('responsesUserText', () => {
  it('collects only user text', () => {
    expect(responsesUserText(user('hello'))).toBe('hello')
    expect(responsesUserText({ role: 'user', content: 'plain' })).toBe('plain')
    expect(responsesUserText({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'typed' }] })).toBe('typed')
    expect(responsesUserText(assistant('answer'))).toBeUndefined()
    expect(responsesUserText({ role: 'developer', content: 'system rules' })).toBeUndefined()
    expect(responsesUserText({ role: 'system', content: 'system rules' })).toBeUndefined()
    expect(responsesUserText(call('c1'))).toBeUndefined()
    expect(responsesUserText(output('c1'))).toBeUndefined()
    expect(responsesUserText({ type: 'pulpo_compaction', role: 'user', content: 'x' })).toBeUndefined()
  })

  it('joins input_text parts with no separator and drops images and files', () => {
    expect(responsesUserText({
      role: 'user',
      content: [
        { type: 'input_text', text: 'first' },
        { type: 'input_text', text: '' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        { type: 'input_file', attachment_id: 'att_1' },
        { type: 'input_text', text: 'second' },
      ],
    })).toBe('firstsecond')
  })

  it('skips empty messages and summaries, new and legacy', () => {
    expect(responsesUserText(user(' '))).toBeUndefined()
    expect(responsesUserText({ role: 'user', content: [{ type: 'input_image', image_url: 'x' }] })).toBeUndefined()
    expect(responsesUserText(user(summaryMessageText('old')))).toBeUndefined()
    for (const prefix of LEGACY_SUMMARY_PREFIXES) expect(responsesUserText({ role: 'user', content: `${prefix}\nold` })).toBeUndefined()
  })
})

describe('buildCompactedResponsesHistory', () => {
  it('keeps user messages, drops everything else and puts the summary last', () => {
    const items = [
      { role: 'developer', content: 'rules' },
      user('first'),
      reasoning('rs_1'),
      call('c1'),
      output('c1'),
      assistant('answer'),
      responsesSummaryItem('older summary'),
      user('second'),
    ]
    const compacted = buildCompactedResponsesHistory(items, 'summary', 20_000)
    expect(compacted.retained).toEqual([{ text: 'first', truncated: false }, { text: 'second', truncated: false }])
    expect(compacted.items).toEqual([
      responsesUserTextItem('first'),
      responsesUserTextItem('second'),
      { role: 'user', content: [{ type: 'input_text', text: `${SUMMARY_PREFIX}\nsummary` }] },
    ])
  })

  it('truncates the boundary message within the budget', () => {
    const compacted = buildCompactedResponsesHistory([user('word '.repeat(200))], 'summary', 16)
    expect(compacted.items).toHaveLength(2)
    expect(responsesUserText(compacted.items[0])).toContain('tokens truncated')
    expect(compacted.items[1]).toEqual(responsesSummaryItem('summary'))
  })
})

describe('dropOldestResponsesUnit', () => {
  it('keeps a leading user message and drops one message', () => {
    expect(dropOldestResponsesUnit([user('task'), assistant('a'), user('next')])).toEqual([user('task'), user('next')])
  })

  it('drops a run of reasoning items with the item that follows them', () => {
    expect(dropOldestResponsesUnit([user('task'), reasoning('r1'), reasoning('r2'), assistant('a'), user('next')]))
      .toEqual([user('task'), user('next')])
  })

  it('drops a function call together with its output', () => {
    expect(dropOldestResponsesUnit([user('task'), reasoning('r1'), call('c1'), output('c1'), assistant('a')]))
      .toEqual([user('task'), assistant('a')])
  })

  it('drops the matching call when an output is dropped first', () => {
    expect(dropOldestResponsesUnit([output('c1'), call('c1'), assistant('a')])).toEqual([assistant('a')])
  })

  it('never leaves orphaned outputs', () => {
    const next = dropOldestResponsesUnit([user('task'), user('extra'), output('lost'), call('c2'), output('c2')])!
    expect(next).toEqual([user('task'), call('c2'), output('c2')])
  })

  it('drops the protected first user message once it is all that remains', () => {
    // An oversized first message must still be droppable, or its chat could never compact.
    expect(dropOldestResponsesUnit([user('task')])).toEqual([])
    expect(dropOldestResponsesUnit([call('c1'), output('c1')])).toEqual([])
    expect(dropOldestResponsesUnit([user('task'), output('lost')])).toEqual([user('task')])
  })

  it('returns undefined only for an empty history', () => {
    expect(dropOldestResponsesUnit([])).toBeUndefined()
  })

  it('shrinks the history by one unit at a time, dropping the protected message last', () => {
    let items: unknown[] | undefined = [user('task'), reasoning('r1'), call('c1'), output('c1'), assistant('a')]
    const lengths: number[] = []
    while (items) {
      lengths.push(items.length)
      items = dropOldestResponsesUnit(items)
    }
    expect(lengths).toEqual([5, 2, 1, 0])
  })

  it('does not mutate its input', () => {
    const items = [user('task'), call('c1'), output('c1'), assistant('a')]
    const snapshot = structuredClone(items)
    dropOldestResponsesUnit(items)
    expect(items).toEqual(snapshot)
  })
})
