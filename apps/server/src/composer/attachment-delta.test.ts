import { expect, it } from 'vitest'
import { composerAttachmentDelta } from './attachment-delta.js'

it('does no attachment writes for typing and inserts only a newly uploaded attachment', () => {
  const files = Array.from({ length: 499 }, (_, index) => ({ id: String(index) }))
  expect(composerAttachmentDelta(files, files)).toEqual({ remove: [], insert: [] })
  expect(composerAttachmentDelta(files, [...files, { id: 'last' }])).toEqual({ remove: [], insert: [{ attachmentId: 'last', position: 499 }] })
})
it('removes moved positions before inserting a reorder and handles clears', () => {
  const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  expect(composerAttachmentDelta(before, [before[1]!, before[0]!, before[2]!])).toEqual({ remove: ['a', 'b'], insert: [{ attachmentId: 'b', position: 0 }, { attachmentId: 'a', position: 1 }] })
  expect(composerAttachmentDelta(before, [])).toEqual({ remove: ['a', 'b', 'c'], insert: [] })
})
