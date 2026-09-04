import { describe, expect, it } from 'vitest'
import type { ComposerDraft } from '@pulpo/contracts'
import { composerDraftMatchesSentSnapshot, composerDraftRevisionMatches } from './conflicts.js'

const draft: ComposerDraft = {
  scope: 'new',
  content: ' send this ',
  modelId: 'model-1',
  presetSelections: { style: 'brief', reasoning: 'high' },
  agentMode: true,
  autoExpire: false,
  editorId: 'other-device',
  attachments: [
    { id: '00000000-0000-4000-8000-000000000001', name: 'one.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: '00000000-0000-4000-8000-000000000002', name: 'two.txt', mimeType: 'text/plain', sizeBytes: 2 },
  ],
  revision: 12,
  updatedAt: new Date().toISOString(),
}

describe('composer draft conflict policy', () => {
  it('accepts the current base, rejects stale live bases, and temporarily permits legacy clients', () => {
    expect(composerDraftRevisionMatches(12, 12)).toBe(true)
    expect(composerDraftRevisionMatches(12, 11)).toBe(false)
    expect(composerDraftRevisionMatches(12, undefined)).toBe(true)
  })

  it('accepts an account absence watermark at or after a retained tombstone', () => {
    expect(composerDraftRevisionMatches(12, 18, true)).toBe(true)
    expect(composerDraftRevisionMatches(12, 11, true)).toBe(false)
  })

  it('only treats the exact sendable snapshot as safe to clear after sending', () => {
    const sent = {
      content: 'send this',
      modelId: 'model-1',
      presetSelections: { reasoning: 'high', style: 'brief' },
      agentMode: true,
      autoExpire: false,
      attachmentIds: draft.attachments.map((attachment) => attachment.id),
    }
    expect(composerDraftMatchesSentSnapshot(draft, sent)).toBe(true)
    expect(composerDraftMatchesSentSnapshot(draft, { ...sent, content: 'newer words' })).toBe(false)
    expect(composerDraftMatchesSentSnapshot(draft, { ...sent, modelId: 'model-2' })).toBe(false)
    expect(composerDraftMatchesSentSnapshot(draft, { ...sent, attachmentIds: [...sent.attachmentIds].reverse() })).toBe(false)
  })
})
