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
      onOperationStarted: started,
      read: vi.fn(async () => document),
      update,
    })
    const result = await tool.execute('operation', {
      expected_revision: 4,
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
      userId: 'user', responseId: 'response', read: vi.fn(async () => document), update,
    })
    await expect(tool.execute('operation', {
      expected_revision: 3,
      summary: 'Remembered project',
      edits: [{ operation: 'append', text: '- Building Pulpo' }],
    }, new AbortController().signal)).rejects.toEqual(expect.objectContaining({
      code: 'memory_document_conflict', currentRevision: 4,
    }))
    expect(update).not.toHaveBeenCalled()
  })

  it('describes MEMORY.md as a model-maintained notebook', () => {
    const tool = createMemoryDocumentTool({ userId: 'user', responseId: 'response' })
    expect(tool.description).toContain('model-maintained notebook')
    expect(tool.description).toContain('improve future conversations')
    expect(tool.description).toContain('keep it useful rather than exhaustive')
  })

  it('allows the model to add useful context without a user-request basis', async () => {
    const update = vi.fn(async (input) => ({
      ...document,
      ...input,
      revision: 5,
      lastEditor: 'agent' as const,
      updatedAt: new Date(),
    }))
    const tool = createMemoryDocumentTool({
      userId: 'user', responseId: 'response', read: vi.fn(async () => document), update,
    })
    await tool.execute('operation', {
      expected_revision: 4,
      summary: 'Added project context',
      edits: [{ operation: 'append', text: '- Building Pulpo' }],
    }, new AbortController().signal)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('- Building Pulpo') }))
  })
})
