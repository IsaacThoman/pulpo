import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Message, UserMessage } from '@earendil-works/pi-ai'
import { anthropicMessagesRequest } from '../upstream/anthropic-messages.js'
import { buildCompactedPiHistory, renderCompactedPiHistory } from './pi-history.js'
import { SUMMARIZATION_PROMPT, SUMMARY_PREFIX, compactedContextText, summaryFromMessageText, summaryMessageText } from './prompt.js'
import { buildCompactedResponsesHistory, renderCompactedResponsesHistory, responsesSummaryItem, responsesUserTextItem } from './responses-history.js'

const piUser = (text: string, timestamp = 1): UserMessage => ({ role: 'user', content: [{ type: 'text', text }], timestamp })
const piAssistant = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'claude-test',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: 2,
})
const assistantItem = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const textOf = (message: Message | undefined) => {
  if (message?.role !== 'user') throw new Error('expected a user message')
  return typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : '').join('')
}
const itemText = (item: unknown) => ((item as { content: Array<{ text: string }> }).content[0]!.text)

describe('summaryFromMessageText', () => {
  it('strips the Codex prefix and only recognizes current summaries', () => {
    expect(summaryFromMessageText(`  ${summaryMessageText(' done ')}`)).toBe('done')
    expect(summaryFromMessageText('Earlier conversation summary:\nold')).toBeUndefined()
    expect(summaryFromMessageText('hello')).toBeUndefined()
  })
})

describe('compactedContextText', () => {
  it('marks every retained message as answered and points at the next message', () => {
    const text = compactedContextText({ retained: ['first question', 'second question'], summary: ' the summary ', lastInProgress: false })
    expect(text).toContain('it is not a new message from the user')
    expect(text).toContain('<earlier_user_message>\nfirst question\n</earlier_user_message>')
    expect(text.indexOf('first question')).toBeLessThan(text.indexOf('second question'))
    expect(text).toContain('All of these messages were already handled earlier in the conversation, and the summary below says what was done; do not answer them again.')
    expect(text).toContain('<conversation_summary>\nthe summary\n</conversation_summary>')
    expect(text.endsWith("Reply to the user's next message.")).toBe(true)
    expect(text).not.toContain(SUMMARY_PREFIX)
  })

  it('keeps the newest message open during a mid-run compaction', () => {
    const text = compactedContextText({ retained: ['old question', 'current task'], summary: 's', lastInProgress: true })
    expect(text).toContain('All but the last of these messages were already handled')
    expect(text).toContain('The last one is the request that was being worked on')
    expect(text.endsWith('continue from where the conversation was compacted.')).toBe(true)
    expect(compactedContextText({ retained: ['current task'], summary: 's', lastInProgress: true }))
      .toContain('This is the request that was being worked on')
  })

  it('omits the message list when nothing was retained', () => {
    const text = compactedContextText({ retained: [], summary: 's', lastInProgress: false })
    expect(text).not.toContain('earlier_user_message')
    expect(text).not.toContain('already handled')
    expect(text.endsWith("Reply to the user's next message.")).toBe(true)
    expect(compactedContextText({ retained: [], summary: 's', lastInProgress: true }).endsWith('continue from where the conversation was compacted.')).toBe(true)
  })
})

describe('renderCompactedPiHistory', () => {
  const history = [piUser('q1'), piAssistant('a1'), piUser('q2'), piAssistant('a2')]
  const head = buildCompactedPiHistory(history, 'covered q1 and q2', 1_000).messages

  it('folds the head into one message ahead of the next prompt', () => {
    const rendered = renderCompactedPiHistory([...head, piUser('q3', 9)])
    expect(rendered).toHaveLength(2)
    expect(textOf(rendered[0])).toBe(compactedContextText({ retained: ['q1', 'q2'], summary: 'covered q1 and q2', lastInProgress: false }))
    expect(rendered[0]!.timestamp).toBe(head.at(-1)!.timestamp)
    expect(textOf(rendered[1])).toBe('q3')
  })

  it('leaves the newest message open when the head ends the history or assistant work follows', () => {
    expect(textOf(renderCompactedPiHistory(head)[0])).toContain('The last one is the request that was being worked on')
    const continued = renderCompactedPiHistory([...head, piAssistant('working'), piUser('later')])
    expect(textOf(continued[0])).toContain('The last one is the request that was being worked on')
    expect(continued.slice(1)).toEqual([piAssistant('working'), piUser('later')])
  })

  it('is idempotent and leaves ordinary or legacy histories unchanged', () => {
    const once = renderCompactedPiHistory([...head, piUser('q3')])
    expect(renderCompactedPiHistory(once)).toEqual(once)
    expect(renderCompactedPiHistory([...once, piUser(SUMMARIZATION_PROMPT)])).toEqual([...once, piUser(SUMMARIZATION_PROMPT)])
    expect(renderCompactedPiHistory(history)).toEqual(history)
    const legacy = [piUser('Earlier conversation summary:\nold'), piUser('next')]
    expect(renderCompactedPiHistory(legacy)).toEqual(legacy)
    // A summary that does not open the history is not a compacted head.
    const late = [piUser('q'), piAssistant('a'), piUser(summaryMessageText('s'))]
    expect(renderCompactedPiHistory(late)).toEqual(late)
  })

  it('needs the summarizer history rendered before its prompt is appended', () => {
    // A mid-run main request sends the head alone; the summary request must open with the same message.
    const main = renderCompactedPiHistory(head)
    expect([...renderCompactedPiHistory(head), piUser(SUMMARIZATION_PROMPT)][0]).toEqual(main[0])
    expect(renderCompactedPiHistory([...head, piUser(SUMMARIZATION_PROMPT)])[0]).not.toEqual(main[0])
  })

  it('does not change the stored history', () => {
    const messages = [...head, piUser('q3')]
    const snapshot = structuredClone(messages)
    renderCompactedPiHistory(messages)
    expect(messages).toEqual(snapshot)
  })
})

describe('renderCompactedResponsesHistory', () => {
  const history = [responsesUserTextItem('q1'), assistantItem('a1'), responsesUserTextItem('q2'), assistantItem('a2')]
  const head = buildCompactedResponsesHistory(history, 'covered q1 and q2', 1_000).items

  it('folds the head into one user item', () => {
    const rendered = renderCompactedResponsesHistory([...head, responsesUserTextItem('q3')])
    expect(rendered).toEqual([
      responsesUserTextItem(compactedContextText({ retained: ['q1', 'q2'], summary: 'covered q1 and q2', lastInProgress: false })),
      responsesUserTextItem('q3'),
    ])
  })

  it('treats an attachment-only prompt as the next user message', () => {
    const imageOnly = { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }
    expect(itemText(renderCompactedResponsesHistory([...head, imageOnly])[0])).toContain('All of these messages were already handled')
  })

  it('renders a summary-only head', () => {
    const rendered = renderCompactedResponsesHistory([responsesSummaryItem('s'), responsesUserTextItem('q')])
    expect(itemText(rendered[0])).toBe(compactedContextText({ retained: [], summary: 's', lastInProgress: false }))
  })

  it('sends Anthropic no bare earlier questions in the merged user turn', () => {
    // Anthropic merges consecutive user entries into one turn; before, that turn opened with the oldest question.
    const request = anthropicMessagesRequest({
      model: 'claude-haiku-5-5',
      input: renderCompactedResponsesHistory([...head, responsesUserTextItem('q3')]),
    }, { stream: false }) as { messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
    expect(request.messages).toHaveLength(1)
    const blocks = request.messages[0]!.content.map((block) => block.text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.startsWith('The earlier part of this conversation was compacted')).toBe(true)
    expect(blocks[0]).toContain('All of these messages were already handled')
    expect(blocks[1]).toBe('q3')
  })
})
