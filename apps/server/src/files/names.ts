import { FILE_NAME_MAX_LENGTH, fileNameError, normalizeFileName, type FileNameError } from '@pulpo/contracts'

const FILE_NAME_MESSAGES: Record<FileNameError, string> = {
  empty: 'Name is required',
  too_long: `Names can be at most ${FILE_NAME_MAX_LENGTH} characters`,
  reserved: 'This name is reserved',
  invalid_character: 'Names cannot contain "/" or control characters',
}

export function fileNameMessage(error: FileNameError): string {
  return FILE_NAME_MESSAGES[error]
}

/** A valid Files name for an attachment: characters Files rejects become `-`, and long names are cut. */
export function attachmentFileName(originalName: string): string {
  const cleaned = [...normalizeFileName(originalName)]
    .map((character) => {
      const code = character.charCodeAt(0)
      return character === '/' || code < 0x20 || code === 0x7f ? '-' : character
    })
    .slice(0, FILE_NAME_MAX_LENGTH)
    .join('')
    .trim()
  return fileNameError(cleaned) ? 'Attachment' : cleaned
}
