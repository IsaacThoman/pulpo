import { describe, expect, it } from 'vitest'
import { composerWriteSchema } from './composer.js'
const base = { draftId: 'new', baseRevision: 0, mutationId: 'device:1', patch: { content: 'hello' } }
describe('composer wire validation', () => {
  it('accepts partial patches and conditional clears', () => {
    expect(composerWriteSchema.parse(base).patch).toEqual({ content: 'hello' })
    expect(composerWriteSchema.parse({ ...base, patch: {}, clear: true }).clear).toBe(true)
  })
  it('rejects invalid scopes, revisions, oversized text, and local file identifiers', () => {
    for (const invalid of [
      { ...base, draftId: '../another-user' }, { ...base, baseRevision: -1 },
      { ...base, patch: { content: 'x'.repeat(1_000_001) } },
      { ...base, patch: { attachments: [{ id: 'file:///local', name: 'a', mimeType: 'image/png', size: 1 }] } },
    ]) expect(composerWriteSchema.safeParse(invalid).success).toBe(false)
  })
})
