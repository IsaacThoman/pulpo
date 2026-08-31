import { describe, expect, it, vi } from 'vitest'
import { createMemoryDocumentTool } from './agent-tool.js'
import { MemoryDocumentError } from './service.js'

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

  it('rebases edits onto the latest document after a concurrent update', async () => {
    const concurrentDocument = {
      ...document,
      content: `${document.content}\n\n# Projects\n- Pulpo`,
      revision: 5,
    }
    const read = vi.fn()
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce(concurrentDocument)
    const update = vi.fn()
      .mockRejectedValueOnce(new MemoryDocumentError('memory_document_conflict', 'MEMORY.md changed', 5))
      .mockImplementationOnce(async (input) => ({
        ...concurrentDocument,
        ...input,
        revision: 6,
        lastEditor: 'agent' as const,
        updatedAt: new Date(),
      }))
    const tool = createMemoryDocumentTool({
      userId: 'user', responseId: 'response', read, update,
    })
    const result = await tool.execute('operation', {
      summary: 'Remembered pet',
      edits: [{ operation: 'append', text: '- Has a cat named Jamie' }],
    }, new AbortController().signal)

    expect(read).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedRevision: 4 }))
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedRevision: 5,
      content: expect.stringContaining('# Projects\n- Pulpo\n\n- Has a cat named Jamie'),
    }))
    expect(JSON.stringify(result)).toContain('Updated MEMORY.md to revision 6')
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
      summary: 'Added project context',
      edits: [{ operation: 'append', text: '- Building Pulpo' }],
    }, new AbortController().signal)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('- Building Pulpo') }))
  })
})
