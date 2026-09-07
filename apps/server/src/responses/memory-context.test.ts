import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../memory-document/service.js', () => ({
  readMemoryDocument: vi.fn(),
  memoryDocumentContext: (document: { content: string }) => document.content,
}))
vi.mock('../episodic-memory/automatic-recall.js', async (original) => ({
  ...await original<typeof import('../episodic-memory/automatic-recall.js')>(),
  retrieveAutomaticRecall: vi.fn(),
}))

import { readMemoryDocument } from '../memory-document/service.js'
import { retrieveAutomaticRecall } from '../episodic-memory/automatic-recall.js'
import { generationSystemPrompt, loadGenerationMemory } from './memory-context.js'

const recall = {
  id: 'response:recall', type: 'pulpo_recall' as const, status: 'completed' as const,
  sources: [{ chat_id: '10000000-0000-4000-8000-000000000001', response_id: '20000000-0000-4000-8000-000000000001', title: 'Secret profile', updated_at: '2026-09-01T00:00:00.000Z', excerpt: 'The user builds secret submarines.' }],
}
const input = {
  chat: { temporary: false }, memoryEnabled: true,
  userId: 'user', responseId: 'response', currentChatId: 'current', query: 'who am I', output: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readMemoryDocument).mockResolvedValue({ content: 'The user is Captain Violet.', revision: 1, lastEditor: 'user', editSummary: '', sourceResponseId: null, updatedAt: null })
  vi.mocked(retrieveAutomaticRecall).mockResolvedValue(recall)
})

describe('generation memory isolation', () => {
  it.each([
    { chat: { temporary: true } }, { chat: undefined }, { chat: null },
    { memoryEnabled: false }, { memoryEnabled: 'true' }, { publicApi: true },
  ])('skips all account memory when disallowed: %j', async (policy) => {
    // Persisted recall must not bypass the policy on retries.
    const context = await loadGenerationMemory({ ...input, ...policy, output: [recall] })
    expect(context).toEqual({ enabled: false, memoryContext: '', recallContext: '', recallItem: null, reusedRecall: false })
    expect(readMemoryDocument).not.toHaveBeenCalled()
    expect(retrieveAutomaticRecall).not.toHaveBeenCalled()
  })

  it('loads the profile and history for a normal chat', async () => {
    const context = await loadGenerationMemory(input)
    expect(context.enabled).toBe(true)
    expect(context.memoryContext).toContain('Captain Violet')
    expect(context.recallContext).toContain('secret submarines')
    expect(context.reusedRecall).toBe(false)
    expect(readMemoryDocument).toHaveBeenCalledWith('user')
    expect(retrieveAutomaticRecall).toHaveBeenCalledOnce()
  })

  it('reuses recall only for an eligible normal chat', async () => {
    const context = await loadGenerationMemory({ ...input, output: [recall] })
    expect(context.reusedRecall).toBe(true)
    expect(context.recallItem).toEqual(recall)
    expect(retrieveAutomaticRecall).not.toHaveBeenCalled()
  })

  it('rebuilds resumed system prompts when memory is disallowed', () => {
    expect(generationSystemPrompt(false, 'Current instructions', 'Old instructions and Captain Violet')).toBe('Current instructions')
    expect(generationSystemPrompt(true, 'Current instructions', 'Original prompt')).toBe('Original prompt')
    expect(generationSystemPrompt(true, 'Current instructions', undefined)).toBe('Current instructions')
  })
})
