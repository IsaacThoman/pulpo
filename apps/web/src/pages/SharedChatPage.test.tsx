import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SharedChatView, type SharedChat } from './SharedChatPage'

const sharedChat: SharedChat = {
  chat: { title: 'Markdown in shared chats', createdAt: '2026-08-20T12:00:00.000Z' },
  responses: [{
    id: 'response-1',
    modelId: 'model-1',
    model: { id: 'model-1', name: 'Pulpo Thinking', logo: 'pulpo' },
    status: 'completed',
    input: [{ role: 'user', content: '**Does markdown work?**' }],
    output: [{ type: 'message', content: [{ text: 'Yes.\n\n- One\n- Two' }] }],
    createdAt: '2026-08-20T12:00:01.000Z',
  }],
}

describe('SharedChatView', () => {
  it('matches chat styling and renders model metadata and markdown', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><SharedChatView share={sharedChat} /></MemoryRouter>,
    )

    expect(markup).toContain('/pulpo-smiley.png')
    expect(markup).toContain('<h1 class="text-2xl font-semibold tracking-tight">Markdown in shared chats</h1>')
    expect(markup.match(/Markdown in shared chats/g)).toHaveLength(1)
    expect(markup).toContain('Pulpo Thinking')
    expect(markup).toContain('<strong class="font-semibold">Does markdown work?</strong>')
    expect(markup).toContain('<ul class="my-2 list-disc')
    expect(markup).toContain('rounded-br-md')
    expect(markup).not.toContain('snapshot')
  })
})
