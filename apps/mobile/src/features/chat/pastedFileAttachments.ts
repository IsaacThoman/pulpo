import { attachmentValidationError } from '@pulpo/client-core'
import { isImageAttachment } from './attachmentExperience'

export type PastedFile = { uri: string; name: string; mimeType: string; size: number }
export type PastedFiles = { files: PastedFile[]; failed: number }

/** Turns files pasted into the composer into attachments, and explains any it couldn't take. */
export function pastedFileAttachments(pasted: PastedFiles, makeId: () => string, maxBytes?: number) {
  const problems: string[] = []
  const attachments = pasted.files.flatMap((file) => {
    const error = attachmentValidationError({ name: file.name, mimeType: file.mimeType, sizeBytes: file.size }, maxBytes)
    if (error) {
      problems.push(`${file.name}: ${error}`)
      return []
    }
    const localId = `paste:${makeId()}`
    return [{
      id: localId,
      localId,
      kind: isImageAttachment(file.name, file.mimeType) ? 'image' as const : 'file' as const,
      mimeType: file.mimeType,
      name: file.name,
      size: file.size,
      uri: file.uri,
      state: 'local' as const,
    }]
  })
  if (pasted.failed > 0) {
    problems.push(pasted.failed === 1
      ? 'One pasted item couldn’t be read.'
      : `${pasted.failed} pasted items couldn’t be read.`)
  }
  return { attachments, error: problems.length ? problems.join('\n') : null }
}
