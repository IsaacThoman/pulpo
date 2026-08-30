import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  inserted: [] as unknown[],
  updated: [] as unknown[],
  deletedCount: 0,
}))

function selectBuilder() {
  const result = mocks.selectResults.shift() ?? []
  const terminal = { limit: vi.fn(async () => result) }
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        ...terminal,
        orderBy: vi.fn(() => terminal),
      })),
    })),
  }
}

function databaseExecutor() {
  return {
    execute: vi.fn(async () => []),
    select: vi.fn(selectBuilder),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        mocks.inserted.push(value)
        return { onConflictDoNothing: vi.fn(async () => undefined) }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => ({
        where: vi.fn(async () => { mocks.updated.push(value) }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => Array.from({ length: mocks.deletedCount }, (_, index) => ({ id: String(index) }))) })),
    })),
  }
}

const executor = vi.hoisted(() => databaseExecutor())

vi.mock('../database/client.js', () => ({
  db: {
    ...executor,
    transaction: vi.fn(async (callback: (tx: typeof executor) => unknown) => callback(executor)),
  },
}))

import {
  applyMemoryDocumentEdits,
  memoryDocumentContext,
  MemoryDocumentError,
  normalizeMemoryDocument,
  purgeExpiredMemoryDocumentRevisions,
  restoreMemoryDocumentRevision,
  updateMemoryDocument,
} from './service.js'

beforeEach(() => {
  mocks.selectResults = []
  mocks.inserted = []
  mocks.updated = []
  mocks.deletedCount = 0
  vi.clearAllMocks()
})

describe('MEMORY.md normalization and patches', () => {
  it('normalizes line endings and outer whitespace while preserving Markdown', () => {
    expect(normalizeMemoryDocument('  # About me\r\n\r\n- Isaac  \r\n')).toBe('# About me\n\n- Isaac')
  })

  it('enforces the 16,000-character limit', () => {
    expect(() => normalizeMemoryDocument('x'.repeat(16_001))).toThrowError(expect.objectContaining({ code: 'memory_document_too_large' }))
  })

  it('applies append, exact replace, and delete edits atomically', () => {
    expect(applyMemoryDocumentEdits('# About\n- Isaac\n- Old preference', [
      { operation: 'replace', oldText: '- Old preference', newText: '- Prefers concise answers' },
      { operation: 'delete', text: '- Isaac' },
      { operation: 'append', text: '## Projects\n- Pulpo' },
    ])).toBe('# About\n\n- Prefers concise answers\n\n## Projects\n- Pulpo')
  })

  it('rejects ambiguous and no-op edits', () => {
    expect(() => applyMemoryDocumentEdits('same same', [{ operation: 'delete', text: 'same' }]))
      .toThrowError(expect.objectContaining({ code: 'memory_document_edit_ambiguous' }))
    expect(() => applyMemoryDocumentEdits('aaa', [{ operation: 'replace', oldText: 'aa', newText: 'b' }]))
      .toThrowError(expect.objectContaining({ code: 'memory_document_edit_ambiguous' }))
    expect(() => applyMemoryDocumentEdits('value', [{ operation: 'replace', oldText: 'value', newText: 'value' }]))
      .toThrowError(expect.objectContaining({ code: 'memory_document_no_change' }))
  })

  it('delimits the complete document with its revision and precedence rule', () => {
    const context = memoryDocumentContext({ content: '# About\n- Isaac', revision: 7 })
    expect(context).toContain('[MEMORY.md revision 7')
    expect(context).toContain('Current explicit user statements take precedence')
    expect(context).toContain('# About\n- Isaac')
    expect(memoryDocumentContext({ content: '', revision: 0 })).toBe('')
  })
})

describe('MEMORY.md versioning', () => {
  it('creates the first document at revision one', async () => {
    mocks.selectResults = [[]]
    await expect(updateMemoryDocument({
      userId: '00000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
      content: '# About',
      editor: 'user',
      summary: 'Created profile',
    })).resolves.toMatchObject({ revision: 1, content: '# About', lastEditor: 'user' })
    expect(mocks.inserted).toHaveLength(1)
  })

  it('snapshots the prior version before an optimistic update', async () => {
    mocks.selectResults = [[{
      userId: 'user', content: 'old', revision: 3, lastEditor: 'agent', editSummary: 'Old edit',
      sourceResponseId: 'response', createdAt: new Date('2026-08-28T00:00:00Z'), updatedAt: new Date('2026-08-28T01:00:00Z'),
    }]]
    const updated = await updateMemoryDocument({ userId: 'user', expectedRevision: 3, content: 'new', editor: 'user', summary: 'Manual edit' })
    expect(updated.revision).toBe(4)
    expect(mocks.inserted[0]).toMatchObject({ revision: 3, content: 'old', editor: 'agent' })
    expect(mocks.updated[0]).toMatchObject({ revision: 4, content: 'new', lastEditor: 'user' })
  })

  it('rejects stale writes without changing storage', async () => {
    mocks.selectResults = [[{ revision: 5, content: 'current' }]]
    await expect(updateMemoryDocument({ userId: 'user', expectedRevision: 4, content: 'stale', editor: 'user', summary: 'Edit' }))
      .rejects.toEqual(expect.objectContaining<Partial<MemoryDocumentError>>({ code: 'memory_document_conflict', currentRevision: 5 }))
    expect(mocks.inserted).toEqual([])
    expect(mocks.updated).toEqual([])
  })

  it('restores a retained snapshot as a new revision', async () => {
    mocks.selectResults = [[{
      id: 'revision-id', userId: 'user', revision: 2, content: 'restored', editor: 'user', editSummary: 'Earlier',
      sourceResponseId: null, versionCreatedAt: new Date(), supersededAt: new Date(),
    }], [{
      userId: 'user', content: 'current', revision: 4, lastEditor: 'agent', editSummary: 'Current',
      sourceResponseId: null, createdAt: new Date(), updatedAt: new Date(),
    }]]
    const restored = await restoreMemoryDocumentRevision({ userId: 'user', revisionId: 'revision-id', expectedRevision: 4 })
    expect(restored).toMatchObject({ revision: 5, content: 'restored', editSummary: 'Restored revision 2' })
  })

  it('purges only expired revision rows through the cleanup path', async () => {
    mocks.deletedCount = 3
    await expect(purgeExpiredMemoryDocumentRevisions(new Date('2026-08-29T00:00:00Z'))).resolves.toBe(3)
  })
})
