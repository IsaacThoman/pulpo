import { basename } from 'node:path'
import type { ToolImagePreview } from '@pulpo/contracts'
import { storeGeneratedAttachment } from './generated.js'
import { createAttachmentThumbnail } from './thumbnail.js'

export async function storeToolImagePreview(input: {
  responseId: string
  toolCallId: string
  userId: string
  chatId: string
  path: string
  data: string
}): Promise<ToolImagePreview> {
  const thumbnail = await createAttachmentThumbnail(Buffer.from(input.data, 'base64'))
  const stored = await storeGeneratedAttachment({
    ...input,
    requestedName: `${basename(input.path).slice(0, 240)}.webp`,
    data: thumbnail,
    origin: 'tool_preview',
  })
  return { attachmentId: stored.id, name: stored.name, mimeType: 'image/webp', sizeBytes: stored.sizeBytes }
}
