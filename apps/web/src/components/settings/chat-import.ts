export const CHAT_IMPORT_FILE_LIMIT_BYTES = 100 * 1024 * 1024

export function chatImportFileIsTooLarge(fileSize: number): boolean {
  return fileSize > CHAT_IMPORT_FILE_LIMIT_BYTES
}
