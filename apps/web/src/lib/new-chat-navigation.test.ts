import { describe, expect, it } from 'vitest'
import { newChatLocationState } from './new-chat-navigation'

describe('newChatLocationState', () => {
  it('carries the selected model when leaving an active chat', () => {
    expect(newChatLocationState(true, 'openai/gpt-5', 'reset-token')).toEqual({
      selectedModelId: 'openai/gpt-5',
    })
  })

  it('requests the default model when starting again from an empty new chat', () => {
    expect(newChatLocationState(false, 'openai/gpt-5', 'reset-token')).toEqual({
      resetDefaultModel: 'reset-token',
    })
  })
})
