import { describe, expect, it } from 'vitest'
import { createGenerationMemoryTools } from './memory-tools.js'

const input = {
  memoryEnabled: true, episodicMemoryEnabled: true, userId: 'user', responseId: 'response',
  currentChatId: 'chat', maxOutputBytes: 4_096,
}
describe('generation memory tools', () => {
  it('exposes no memory tools when the generation memory policy denies access', () => {
    expect(createGenerationMemoryTools({ ...input, memoryEnabled: false })).toEqual([])
  })
  it('preserves all memory tools for eligible normal chats', () => {
    expect(createGenerationMemoryTools(input).map((tool) => tool.name)).toEqual(['search_chats', 'read_chat', 'update_memory'])
  })
  it('keeps profile editing independent of episodic search availability', () => {
    expect(createGenerationMemoryTools({ ...input, episodicMemoryEnabled: false }).map((tool) => tool.name)).toEqual(['update_memory'])
  })
})
