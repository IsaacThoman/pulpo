// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import type { Chat, Message } from '@/lib/types'
import i18n from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { activityDurationMs } from './activity-timing'

const mediaQuery = { matches: false, addEventListener: () => undefined }
const storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => mediaQuery,
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
})
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: storage,
})

const { useSettings } = await import('@/stores/settings')

afterEach(cleanup)
beforeEach(() => useSettings.setState({ showReasoning: true }))

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

function user(overrides: Partial<Message> = {}): Message {
  return {
    id: 'response-1:input', role: 'user', content: 'Prompt',
    timestamp: 1, done: true, ...overrides,
  }
}

describe('user message actions', () => {
  it('renders branch navigation after copy, edit, and delete actions', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={user({ branch: { ids: ['response-1', 'response-2'], index: 1 } })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(markup.indexOf('aria-label="Copy"')).toBeLessThan(markup.indexOf('aria-label="Previous branch"'))
    expect(markup.indexOf('aria-label="Edit"')).toBeLessThan(markup.indexOf('aria-label="Previous branch"'))
    expect(markup.indexOf('aria-label="Delete message"')).toBeLessThan(markup.indexOf('aria-label="Previous branch"'))
  })

  it('keeps edit enabled while an assistant response is streaming', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={{ ...chat, messages: [user(), assistant({ done: false })] }}
      message={user()}
      streaming={false}
      activeModelId="model-1"
    />)

    const editButton = markup.match(/<button[^>]*aria-label="Edit"[^>]*>/)?.[0]
    expect(editButton).toBeDefined()
    expect(editButton).not.toContain(' disabled=""')
  })
})

describe('assistant response metadata', () => {
  beforeEach(() => {
    useSettings.setState({ showResponseCost: false })
  })

  it('hides cost by default while retaining the other response metadata', async () => {
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<MessageItem
      chat={chat}
      message={assistant({
        content: 'Answer',
        tokensIn: 802,
        tokensOut: 12,
        cost: 0.0042,
        inferenceReferenceCost: 0.0385,
        latencyMs: 932,
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    const text = container.textContent ?? ''
    expect(text).toContain('802→12 tok · 13tok/sec · 932ms')
    expect(text).not.toContain('$0.0042')
    expect(container.querySelector('[data-inference-reference-cost]')).toBeNull()
  })

  it('renders tokens, speed, time, and cost in that order', async () => {
    useSettings.setState({ showResponseCost: true })
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<MessageItem
      chat={chat}
      message={assistant({
        content: 'Answer',
        tokensIn: 802,
        tokensOut: 12,
        cost: 0.0042,
        latencyMs: 932,
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(container.textContent).toContain('802→12 tok · 13tok/sec · 932ms · $0.0042')
  })

  it('keeps subscription-covered cost neutral with the usage-page tooltip', async () => {
    useSettings.setState({ showResponseCost: true })
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<TooltipProvider><MessageItem
      chat={chat}
      message={assistant({
        content: 'Answer',
        tokensIn: 802,
        tokensOut: 12,
        cost: 0.0042,
        subscriptionCoveredCost: 0.003,
        latencyMs: 932,
      })}
      streaming={false}
      activeModelId="model-1"
    /></TooltipProvider>)

    const markup = container.innerHTML
    expect(markup).toContain('data-subscription-coverage="partial"')
    expect(markup).not.toContain('text-violet-700')
    expect(markup).toContain('cursor-help')
    expect(markup).toContain('aria-label="$0.0042 · $0.0030 covered by your subscription · $0.0012 charged to balance"')
  })

  it('matches the usage table total and breakdown for subscription-backed inference', async () => {
    useSettings.setState({ showResponseCost: true })
    const { MessageItem } = await import('./MessageItem')
    const { UsageCostBreakdown } = await import('@/components/usage/UsageCostBreakdown')
    const { container } = render(<TooltipProvider>
      <MessageItem
        chat={chat}
        message={assistant({
          content: 'Answer', tokensIn: 2_936, tokensOut: 183,
          cost: 0.0017, inferenceReferenceCost: 0.0385, latencyMs: 18_700,
        })}
        streaming={false}
        activeModelId="model-1"
      />
      <div data-testid="usage-table-cost">
        <UsageCostBreakdown costUsd={0.0017} inferenceReferenceUsd={0.0385} subscriptionCoveredUsd={0} personal />
      </div>
    </TooltipProvider>)

    const annotation = container.querySelector('[data-inference-reference-cost]')
    const tableCost = container.querySelector('[data-testid="usage-table-cost"] [data-inference-reference-cost]')
    expect(annotation?.textContent).toBe('$0.0402')
    expect(annotation?.textContent).toBe(tableCost?.textContent)
    expect(annotation?.getAttribute('aria-label')).toBe('$0.0402 · API equivalent: $0.0385 · Pulpo usage: $0.0017')
    expect(annotation?.getAttribute('aria-label')).toBe(tableCost?.getAttribute('aria-label'))
  })

  it.each([undefined, 0])('uses usage-table precision when inference reference cost is %s', async (inferenceReferenceCost) => {
    useSettings.setState({ showResponseCost: true })
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<MessageItem
      chat={chat}
      message={assistant({ content: 'Answer', cost: 0.0123, inferenceReferenceCost })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(container.textContent).toContain('$0.0123')
    expect(container.querySelector('[data-inference-reference-cost]')).toBeNull()
  })
})

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

describe('show reasoning preference', () => {
  it.each([false, true])('updates work visibility immediately when streaming is %s', async (streaming) => {
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<MessageItem
      chat={chat}
      message={assistant({
        done: !streaming,
        content: 'Answer',
        outputItems: [
          { type: 'pulpo_workspace', state: 'ready' },
          { type: 'reasoning', status: 'completed', summary: [{ text: 'Private summary' }] },
          { type: 'pulpo_tool', tool: 'bash', status: 'completed', output: 'Tool output' },
          { type: 'custom_result', value: 'Extra work details' },
          { type: 'message', content: [{ text: 'Answer' }] },
        ],
      })}
      streaming={streaming}
      activeModelId="model-1"
    />)

    expect(container.textContent).toContain('Worked')
    expect(container.textContent).toContain('Extra work details')
    act(() => useSettings.setState({ showReasoning: false }))
    expect(container.textContent).toContain('Answer')
    for (const hidden of ['Worked', 'Private summary', 'Started workspace', 'Tool output', 'Extra work details']) {
      expect(container.textContent).not.toContain(hidden)
    }
    act(() => useSettings.setState({ showReasoning: true }))
    expect(container.textContent).toContain('Worked')
    expect(container.textContent).toContain('Extra work details')
  })

  it('keeps the pending indicator while streaming hidden work without answer text', async () => {
    useSettings.setState({ showReasoning: false })
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<MessageItem
      chat={chat}
      message={assistant({
        done: false,
        outputItems: [{ type: 'pulpo_tool', tool: 'bash', status: 'running' }],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(container.querySelector('.animate-bounce')).not.toBeNull()
    expect(container.textContent).not.toContain('Running')
    expect(container.textContent).not.toContain('Working')
  })

  it('keeps cached answer text and terminal errors visible while hiding legacy reasoning', async () => {
    useSettings.setState({ showReasoning: false })
    const { MessageItem } = await import('./MessageItem')
    const { container } = render(<MessageItem
      chat={chat}
      message={assistant({ content: 'Answer', reasoning: 'Private summary', error: 'Generation failed' })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(container.textContent).toContain('Answer')
    expect(container.textContent).toContain('Generation failed')
    expect(container.textContent).not.toContain('Thought')
    expect(container.textContent).not.toContain('Private summary')
  })
})

describe('live tool activity presentation', () => {
  it('shows a friendly running label and matching icon', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        done: false,
        outputItems: [{
          type: 'pulpo_tool', id: 'tool-1', tool: 'web_fetch', status: 'running',
          arguments: { url: 'https://example.com' }, output: '',
        }],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).toContain('Fetching a webpage…')
    expect(markup).toContain('lucide-globe')
  })

  it('shows generic working copy between tool calls', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        done: false,
        outputItems: [{
          type: 'pulpo_tool', id: 'tool-1', tool: 'web_search', status: 'completed', output: 'result',
        }],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).toContain('Working…')
    expect(markup).not.toContain('Running web_search…')
  })
})

describe('recalled chat activity', () => {
  it('summarizes recalled sources in the normal activity disclosure', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        outputItems: [{
          id: 'response-1:recall', type: 'pulpo_recall', status: 'completed',
          sources: [{
            chat_id: '00000000-0000-4000-8000-000000000001',
            response_id: '00000000-0000-4000-8000-000000000002',
            title: 'Earlier architecture chat', updated_at: '2026-08-27T00:00:00.000Z',
            excerpt: 'Use a parallel index generation during model changes.',
          }],
        }, { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }],
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(markup).toContain('Recalled from 1 chat')
    expect(markup).not.toContain('Recalled from 1 chat.')
    expect(markup).not.toContain('pulpo recall')
  })

  it('uses the plural label for multiple recalled sources', async () => {
    const { MessageItem } = await import('./MessageItem')
    const source = {
      response_id: '00000000-0000-4000-8000-000000000002',
      title: 'Earlier architecture chat', updated_at: '2026-08-27T00:00:00.000Z',
      excerpt: 'Use a parallel index generation during model changes.',
    }
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        outputItems: [{
          id: 'response-1:recall', type: 'pulpo_recall', status: 'completed',
          sources: [
            { ...source, chat_id: '00000000-0000-4000-8000-000000000001' },
            { ...source, chat_id: '00000000-0000-4000-8000-000000000003' },
          ],
        }, { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }],
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(markup).toContain('Recalled from 2 chats')
    expect(markup).not.toContain('Recalled from 2 chats.')
  })

  it('keeps thought and work as the summary when recall accompanies other activity', async () => {
    const { MessageItem } = await import('./MessageItem')
    const recall = {
      id: 'response-1:recall', type: 'pulpo_recall' as const, status: 'completed',
      sources: [{
        chat_id: '00000000-0000-4000-8000-000000000001',
        response_id: '00000000-0000-4000-8000-000000000002',
        title: 'Earlier architecture chat', updated_at: '2026-08-27T00:00:00.000Z',
        excerpt: 'Use a parallel index generation during model changes.',
      }],
    }
    const worked = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        outputItems: [
          recall,
          { type: 'pulpo_tool', id: 'tool-1', tool: 'web_search', status: 'completed', output: 'result' },
          { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] },
        ],
      })}
      streaming={false}
      activeModelId="model-1"
    />)
    const thought = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        outputItems: [
          recall,
          { type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: 'Checked the recalled context' }] },
          { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] },
        ],
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(worked).toContain('Worked')
    expect(worked).not.toContain('Recalled from 1 chat')
    expect(thought).toContain('Thought')
    expect(thought).not.toContain('Recalled from 1 chat')
  })
})

describe('Spanish activity summaries', () => {
  it('translates completed work and reasoning as complete phrases', async () => {
    await i18n.changeLanguage('es-ES')
    try {
      const { MessageItem } = await import('./MessageItem')
      const worked = renderToStaticMarkup(<MessageItem
        chat={chat}
        message={assistant({
          outputItems: [{
            type: 'pulpo_tool', id: 'tool-1', tool: 'web_search', status: 'completed',
            output: 'result', durationMs: 3_000,
          }],
        })}
        streaming={false}
        activeModelId="model-1"
      />)
      const thought = renderToStaticMarkup(<MessageItem
        chat={chat}
        message={assistant({
          outputItems: [{
            type: 'reasoning', status: 'completed', durationMs: 3_000,
            summary: [{ type: 'summary_text', text: 'Resumen' }],
          }],
        })}
        streaming={false}
        activeModelId="model-1"
      />)

      expect(worked).toContain('Trabajó durante 3 segundos')
      expect(thought).toContain('Pensó durante 3 segundos')
      expect(worked).not.toContain('Worked')
      expect(thought).not.toContain('Thought')
    } finally {
      await i18n.changeLanguage('en-US')
    }
  })

  it('translates queued and failed workspace states', async () => {
    await i18n.changeLanguage('es-ES')
    try {
      const { MessageItem } = await import('./MessageItem')
      const queued = renderToStaticMarkup(<MessageItem
        chat={chat}
        message={assistant({
          done: false,
          outputItems: [{ type: 'pulpo_workspace', state: 'waiting', position: 3 }],
        })}
        streaming
        activeModelId="model-1"
      />)
      const expired = renderToStaticMarkup(<MessageItem
        chat={chat}
        message={assistant({
          outputItems: [{ type: 'pulpo_workspace', state: 'expired' }],
        })}
        streaming={false}
        activeModelId="model-1"
      />)

      expect(queued).toContain('Esperando un espacio de trabajo · puesto 3 en la cola')
      expect(expired).toContain('Espacio de trabajo caducado')
      expect(queued).not.toContain('Waiting for workspace')
      expect(expired).not.toContain('Workspace expired')
    } finally {
      await i18n.changeLanguage('en-US')
    }
  })
})

describe('workspace continue timing', () => {
  it('shows the action immediately when the server eligibility time has passed', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        done: false,
        outputItems: [{
          type: 'pulpo_workspace', state: 'waiting', startedAt: '2000-01-01T00:00:00.000Z',
          continueWithoutAgentAvailableAt: '2000-01-01T00:00:15.000Z',
        }],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).toContain('Continue without agent')
  })

  it('hides the action until the server eligibility time', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        done: false,
        outputItems: [{
          type: 'pulpo_workspace', state: 'waiting', startedAt: '2999-01-01T00:00:00.000Z',
          continueWithoutAgentAvailableAt: '2999-01-01T00:00:15.000Z',
        }],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).not.toContain('Continue without agent')
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

describe('assistant streaming caret', () => {
  it('shows the caret when streaming text is the timeline frontier', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        content: 'Writing the answer',
        outputItems: [
          { type: 'message', content: [{ type: 'output_text', text: 'Writing the answer' }] },
        ],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).toContain('stream-caret')
  })

  it('hides the caret when running tool activity follows text', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        content: 'Let me check that.',
        outputItems: [
          { type: 'message', content: [{ type: 'output_text', text: 'Let me check that.' }] },
          { type: 'pulpo_tool', id: 'tool-1', tool: 'search', status: 'running', output: '' },
        ],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).not.toContain('stream-caret')
  })

  it('shows the caret on text emitted after tool activity', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        content: 'Here is what I found.',
        outputItems: [
          { type: 'pulpo_tool', id: 'tool-1', tool: 'search', status: 'completed', output: 'result' },
          { type: 'message', content: [{ type: 'output_text', text: 'Here is what I found.' }] },
        ],
      })}
      streaming
      activeModelId="model-1"
    />)

    expect(markup).toContain('stream-caret')
  })

  it('hides the caret when the response is complete', async () => {
    const { MessageItem } = await import('./MessageItem')
    const markup = renderToStaticMarkup(<MessageItem
      chat={chat}
      message={assistant({
        content: 'The answer is complete.',
        outputItems: [
          { type: 'message', content: [{ type: 'output_text', text: 'The answer is complete.' }] },
        ],
      })}
      streaming={false}
      activeModelId="model-1"
    />)

    expect(markup).not.toContain('stream-caret')
  })
})
