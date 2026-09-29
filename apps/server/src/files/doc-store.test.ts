import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'

vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))
vi.mock('../database/client.js', () => ({ db: {} }))

const { initialDocState } = await import('./doc-store.js')

describe('document creation', () => {
  it('starts empty without content', () => {
    const { state, markdown } = initialDocState()
    expect(markdown).toBe('')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    expect(doc.getXmlFragment('default').length).toBe(0)
  })

  it('imports Markdown into the collaborative state', () => {
    const { state, markdown } = initialDocState('# Notes\n\n- a\n- b')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    expect(ydocToMarkdown(doc)).toBe(markdown)
    expect(markdown).toContain('# Notes')
  })
})
