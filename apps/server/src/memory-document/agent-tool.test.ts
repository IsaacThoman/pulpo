import { describe, expect, it, vi } from 'vitest'
import { createMemoryDocumentTool } from './agent-tool.js'

const document = {
  content: '# About\n- Isaac\n\n# Preferences\n- Verbose answers',
  revision: 4,
  lastEditor: 'user' as const,
  editSummary: 'Edited in Settings',
  sourceResponseId: null,
  updatedAt: new Date(),
}

describe('update_memory Agent tool', () => {
  it('applies changed snippets without returning the complete document', async () => {
    const started = vi.fn()
    const update = vi.fn(async (input) => ({
      ...document,
      ...input,
      revision: 5,
      lastEditor: 'agent' as const,
      updatedAt: new Date(),
    }))
    const tool = createMemoryDocumentTool({
      userId: 'user',
      responseId: 'response',
      userMessage: 'I prefer concise answers.',
      onOperationStarted: started,
      read: vi.fn(async () => document),
      update,
    })
    const result = await tool.execute('operation', {
      expected_revision: 4,
      basis: 'preference_confirmation',
      summary: 'Updated answer-length preference',
      edits: [{ operation: 'replace', old_text: '- Verbose answers', new_text: '- Concise answers' }],
    }, new AbortController().signal)

    expect(started).toHaveBeenCalledWith('operation')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user', expectedRevision: 4, editor: 'agent', sourceResponseId: 'response',
      content: expect.stringContaining('- Concise answers'),
    }))
    const text = JSON.stringify(result)
    expect(text).toContain('Updated MEMORY.md to revision 5')
    expect(text).not.toContain('# About')
    expect(text).not.toContain('Isaac')
  })

  it('rejects stale revisions before writing', async () => {
    const update = vi.fn()
    const tool = createMemoryDocumentTool({
      userId: 'user', responseId: 'response', userMessage: 'Remember that I am building Pulpo.', read: vi.fn(async () => document), update,
    })
    await expect(tool.execute('operation', {
      expected_revision: 3,
      basis: 'user_request',
      summary: 'Remembered project',
      edits: [{ operation: 'append', text: '- Building Pulpo' }],
    }, new AbortController().signal)).rejects.toEqual(expect.objectContaining({
      code: 'memory_document_conflict', currentRevision: 4,
    }))
    expect(update).not.toHaveBeenCalled()
  })

  it('describes the narrow proactive-write and secret policy', () => {
    const tool = createMemoryDocumentTool({ userId: 'user', responseId: 'response', userMessage: 'Remember this.' })
    expect(tool.description).toContain('explicit identity confirmation')
    expect(tool.description).toContain('explicit preference confirmation')
    expect(tool.description).toContain('credentials')
    expect(tool.description).toContain('recalled claims')
  })

  it('rejects a claimed proactive basis that the user message does not support', async () => {
    const tool = createMemoryDocumentTool({
      userId: 'user', responseId: 'response', userMessage: 'What is the weather?', read: vi.fn(async () => document),
    })
    await expect(tool.execute('operation', {
      expected_revision: 4,
      basis: 'preference_confirmation',
      summary: 'Guessed a preference',
      edits: [{ operation: 'append', text: '- Prefers sunny weather' }],
    }, new AbortController().signal)).rejects.toEqual(expect.objectContaining({ code: 'memory_document_basis_not_permitted' }))
  })

  it('rejects credentials and secrets from changed snippets', async () => {
    const tool = createMemoryDocumentTool({
      userId: 'user', responseId: 'response', userMessage: 'Remember my API key.', read: vi.fn(async () => document),
    })
    await expect(tool.execute('operation', {
      expected_revision: 4,
      basis: 'user_request',
      summary: 'Saved credential',
      edits: [{ operation: 'append', text: 'API key: sk-this-should-never-be-stored' }],
    }, new AbortController().signal)).rejects.toEqual(expect.objectContaining({ code: 'memory_document_secret_rejected' }))
  })
})
