import { codeLanguageFor } from '@pulpo/client-core/files'
import type { CodePreviewKind } from './code-preview'

// One highlighter and one extension table for chat, file viewers, and the mobile apps.
export {
  highlightTree,
  MAX_AUTO_HIGHLIGHT_CHARACTERS,
  MAX_HIGHLIGHT_CHARACTERS,
  normalizeLanguage,
} from '@pulpo/client-core/highlight'

/** The highlight.js grammar for a file, from its name and then its MIME type; null for plain text. */
export function languageForFile(name: string, mimeType = ''): string | null {
  return codeLanguageFor(name, mimeType)
}

export function languageForPreviewKind(kind: CodePreviewKind): string {
  return kind === 'jsx' ? 'javascript' : 'xml'
}
