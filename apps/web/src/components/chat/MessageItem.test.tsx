import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message } from '@/lib/types'
import { activityDurationMs } from './activity-timing'

const mediaQuery = { matches: false, addEventListener: () => undefined }
Object.assign(globalThis, {
  document: { documentElement: { classList: { toggle: () => undefined } } },
  window: { matchMedia: () => mediaQuery },
})

const chat: Chat = {
  id: 'chat-1', title: 'Chat', modelId: 'model-1', messages: [],
  createdAt: 1, updatedAt: 1, pinned: false, folderId: null, sortOrder: 0,
  tags: [], temporary: false, expiresAt: null, expired: false,
}

function assistant(overrides: Partial<Message> = {}): Message {
  return {
    id: 'response-1', role: 'assistant', content: '', modelId: 'model-1',
    timestamp: 1, done: true, ...overrides,
  }
}

describe('activityDurationMs', () => {
  it('attributes only the durations belonging to an activity segment', () => {
    expect(activityDurationMs([
      { kind: 'reasoning', durationMs: 2_400 },
      { kind: 'workspace', workspace: { durationMs: 1_100 } },
      { kind: 'tool', tool: { durationMs: 3_500 } },
    ])).toBe(7_000)

    expect(activityDurationMs([
      { kind: 'reasoning', durationMs: 900 },
    ])).toBe(900)
  })

  it('does not invent a segment duration when timing metadata is absent', () => {
    expect(activityDurationMs([
      { kind: 'reasoning' },
    ])).toBeUndefined()
  })
})

describe('assistant terminal error rendering', () => {
  it('keeps generated output before an appended terminal error', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        content: 'Previously generated answer',
        error: '400 Your input exceeds the context window of this model.',
        outputItems: [
          { type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: 'Checked the request' }] },
          { type: 'pulpo_tool', id: 'tool-1', tool: 'search', status: 'completed', output: 'result' },
          { type: 'message', content: [{ type: 'output_text', text: 'Previously generated answer' }] },
          { type: 'custom_result', value: 'extra output' },
        ],
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(markup).toContain('Previously generated answer')
    expect(markup).toContain('400 Your input exceeds the context window')
    expect(markup).toContain('Worked')
    expect(markup.indexOf('Previously generated answer')).toBeLessThan(markup.indexOf('400 Your input exceeds the context window'))
    expect(markup.indexOf('custom result')).toBeLessThan(markup.indexOf('400 Your input exceeds the context window'))
    expect(markup).toContain('role="alert"')
  })

  it('retains the standalone alert for an error-only response', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({ error: 'Generation failed' })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(markup).toContain('Generation failed')
    expect(markup).toContain('role="alert"')
  })
})
