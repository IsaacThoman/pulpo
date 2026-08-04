import { describe, expect, it } from 'vitest'
import { projectSharedMessages } from './shared'

describe('projectSharedMessages', () => {
  it('preserves markdown output order while excluding reasoning from public shares', () => {
    const messages = projectSharedMessages([{
      id: 'response-1', modelId: 'gpt-5',
      input: [{ role: 'developer', content: 'secret' }, { role: 'user', content: [{ type: 'input_text', text: '**Question**' }] }],
      output: [
        { type: 'reasoning', summary: [{ text: 'private thought' }] },
        { type: 'message', content: [{ text: '# Answer\n\n$E=mc^2$' }] },
        { type: 'message', content: [{ text: '| A | B |\n| - | - |' }] },
      ],
    }])

    expect(messages).toEqual([
      { id: 'response-1:input', role: 'user', text: '**Question**', modelId: 'gpt-5' },
      { id: 'response-1', role: 'assistant', text: '# Answer\n\n$E=mc^2$\n\n| A | B |\n| - | - |', modelId: 'gpt-5' },
    ])
  })
})
