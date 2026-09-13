import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { authSettingsSchema, createChatResponseSchema, emptyComposerState, composerStateSchema } from './index.js'
import { shelfContentSchema } from './shelf.js'
import { imageBatchNeedsWorkspace, MAX_INLINE_IMAGE_BYTES } from './attachment-limits.js'

it('keeps hundreds of attachments through send, sync, and shelving with the same bound', () => {
  const ids = Array.from({ length: 500 }, () => randomUUID())
  const state = { ...emptyComposerState(), attachments: ids.map((id) => ({ id, name: 'file', mimeType: 'text/plain', size: 1 })) }
  expect(composerStateSchema.parse(state).attachments).toHaveLength(500)
  expect(shelfContentSchema.parse({ content: '', attachmentIds: ids }).attachmentIds).toHaveLength(500)
  expect(createChatResponseSchema.safeParse({ input: 'files', modelId: randomUUID(), attachmentIds: ids }).success).toBe(true)
  expect(composerStateSchema.safeParse({ ...state, attachments: [...state.attachments, state.attachments[0]] }).success).toBe(false)
  expect(shelfContentSchema.safeParse({ content: '', attachmentIds: [...ids, randomUUID()] }).success).toBe(false)
})

it('defaults to five prompt images and allows an admin override or no inline images', () => {
  expect(authSettingsSchema.parse({}).maxInlineImages).toBe(5)
  expect(authSettingsSchema.parse({ maxInlineImages: 8 }).maxInlineImages).toBe(8)
  expect(imageBatchNeedsWorkspace(Array.from({ length: 5 }, () => ({ sizeBytes: 100 })))).toBe(false)
  expect(imageBatchNeedsWorkspace(Array.from({ length: 6 }, () => ({ sizeBytes: 100 })))).toBe(true)
  expect(imageBatchNeedsWorkspace([{ sizeBytes: 1 }], 0)).toBe(true)
  expect(imageBatchNeedsWorkspace([{ sizeBytes: MAX_INLINE_IMAGE_BYTES + 1 }])).toBe(true)
  expect(authSettingsSchema.safeParse({ maxInlineImages: 21 }).success).toBe(false)
})
