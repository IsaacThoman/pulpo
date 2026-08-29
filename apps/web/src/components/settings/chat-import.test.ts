import { describe, expect, it } from 'vitest'
import { CHAT_IMPORT_FILE_LIMIT_BYTES, chatImportFileIsTooLarge } from './chat-import'

describe('chat import file preflight', () => {
  it('accepts files up to and including 100 MiB', () => {
    expect(CHAT_IMPORT_FILE_LIMIT_BYTES).toBe(100 * 1024 * 1024)
    expect(chatImportFileIsTooLarge(CHAT_IMPORT_FILE_LIMIT_BYTES)).toBe(false)
  })

  it('rejects files larger than 100 MiB', () => {
    expect(chatImportFileIsTooLarge(CHAT_IMPORT_FILE_LIMIT_BYTES + 1)).toBe(true)
  })
})
