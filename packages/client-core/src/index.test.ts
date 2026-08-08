import { describe, expect, it } from 'vitest'
import {
  attachmentValidationError,
  hydrateEmbeddedResponseSnapshot,
  lineageFromLeaf,
  mergeRevisionInvalidation,
  normalizeInstanceUrl,
  reconcileResponseEvents,
  resolvePresetActions,
} from './index.js'

describe('client core', () => {
  it('hydrates compact embedded snapshots from the canonical response output', () => {
    const marker = {
      responseId: '00000000-0000-4000-8000-000000000001', status: 'completed' as const,
      sequence: 4, usage: null, error: null, updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const output = [{ type: 'message', content: 'answer' }]
    expect(hydrateEmbeddedResponseSnapshot(marker, output)).toEqual({ ...marker, output })
    const full = { ...marker, output: [] }
    expect(hydrateEmbeddedResponseSnapshot(full, output)).toBe(full)
  })

  it('selects a branch lineage without looping malformed trees', () => {
    const nodes = [
      { id: 'root', parentResponseId: null },
      { id: 'left', parentResponseId: 'root' },
      { id: 'right', parentResponseId: 'root' },
      { id: 'leaf', parentResponseId: 'right' },
    ]
    expect(lineageFromLeaf(nodes, 'leaf').map((node) => node.id)).toEqual(['root', 'right', 'leaf'])
  })

  it('normalizes HTTPS instances and only permits local development HTTP', () => {
    expect(normalizeInstanceUrl('pulpo.baby/')).toBe('https://pulpo.baby')
    expect(normalizeInstanceUrl('http://localhost:3000/', true)).toBe('http://localhost:3000')
    expect(() => normalizeInstanceUrl('http://example.com')).toThrow('HTTPS')
    expect(() => normalizeInstanceUrl('https://pulpo.baby/?token=nope')).toThrow('origin')
  })

  it('reconciles unordered streaming events monotonically', () => {
    const responseId = '00000000-0000-4000-8000-000000000001'
    const snapshot = { responseId, status: 'in_progress' as const, sequence: 0, output: [], usage: null, error: null, updatedAt: '2026-08-01T00:00:00.000Z' }
    const result = reconcileResponseEvents(snapshot, [
      { responseId, sequence: 2, type: 'response.output_text.delta', payload: { delta: 'two' }, emittedAt: '2026-08-01T00:00:02.000Z' },
      { responseId, sequence: 1, type: 'response.output_text.delta', payload: { delta: 'one ' }, emittedAt: '2026-08-01T00:00:01.000Z' },
    ])
    expect(result.output).toMatchObject([{ content: [{ text: 'one two' }] }])
  })

  it('coalesces paired account and chat revisions without hiding account-only changes', () => {
    const account = mergeRevisionInvalidation(undefined, { revision: 10 })
    const paired = mergeRevisionInvalidation(account, { revision: 10, chatId: 'chat-1' })
    const combined = mergeRevisionInvalidation(paired, { revision: 11 })
    expect(combined).toEqual({
      revision: 11,
      chatIds: ['chat-1'],
      accountOnlyRevisions: [11],
    })
  })

  it('resolves preset defaults and filters parameters', async () => {
    const result = await resolvePresetActions('model', {}, async () => ({
      id: 'model', enabled: true, allowedParameters: ['reasoning_effort'],
      presets: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'high', choices: [
        { id: 'high', displayName: 'High', action: { type: 'params', params: { reasoning_effort: 'high', model: 'forbidden' } } },
      ] }],
    }))
    expect(result).toMatchObject({ effectiveModelId: 'model', parameters: { reasoning_effort: 'high' } })
  })

  it('validates native attachments', () => {
    expect(attachmentValidationError({ name: 'notes.md', mimeType: 'text/markdown', sizeBytes: 10 })).toBeNull()
    expect(attachmentValidationError({ name: 'page.html', mimeType: 'text/html', sizeBytes: 10 })).toMatch(/not supported/)
  })
})
