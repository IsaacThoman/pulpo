import { attachmentValidationError } from '@pulpo/client-core'
import type { IncomingFile } from './incomingFileQueue'
import { isImageAttachment, MAX_COMPOSER_ATTACHMENTS } from './attachmentExperience'

export function incomingFileAttachment(item: IncomingFile, current: readonly { localId: string }[], maxBytes?: number) {
  const localId = `import:${item.id}`
  if (current.some((attachment) => attachment.localId === localId)) return { duplicate: true as const }
  if (!item.file) return { error: item.error ?? 'The file is still being imported.' }
  if (current.length >= MAX_COMPOSER_ATTACHMENTS) return { error: `You can attach up to ${MAX_COMPOSER_ATTACHMENTS} items.` }
  const file = item.file
  const error = attachmentValidationError({ name: file.name, mimeType: file.mimeType, sizeBytes: file.size }, maxBytes)
  if (error) return { error }
  return { attachment: { ...file, id: localId, localId,
    kind: isImageAttachment(file.name, file.mimeType) ? 'image' as const : 'file' as const,
    state: 'local' as const } }
}
