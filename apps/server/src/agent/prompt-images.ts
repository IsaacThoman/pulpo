import type { ImageContent } from '@earendil-works/pi-ai'
import { getBlobStore } from '../storage/index.js'
import { modelImageRendition } from '../responses/model-image.js'

export interface AgentPromptImage extends ImageContent {
  label: string
  attachmentId: string
  sourceChecksum: string | null
}

export interface AgentPromptImageAttachment {
  id: string
  originalName: string
  mimeType: string
  objectKey: string
  checksum: string | null
}

type ReadAttachment = (objectKey: string) => Promise<Uint8Array>

export async function loadAgentPromptImages(
  attachments: readonly AgentPromptImageAttachment[],
  readAttachment: ReadAttachment = (objectKey) => getBlobStore().get(objectKey),
): Promise<AgentPromptImage[]> {
  const images: AgentPromptImage[] = []
  for (const attachment of attachments) {
    if (!attachment.mimeType.startsWith('image/')) continue
    const bytes = await readAttachment(attachment.objectKey)
    const rendition = await modelImageRendition(bytes, attachment.mimeType, attachment.checksum)
    images.push({
      type: 'image',
      data: rendition.data.toString('base64'),
      mimeType: rendition.mimeType,
      label: attachment.originalName,
      attachmentId: attachment.id,
      sourceChecksum: attachment.checksum,
    })
  }
  return images
}
