import { editorBundleFor } from './editor/bundles'
import { formatSupported } from './availability'
import type { MobileConfig } from '@pulpo/contracts'

/** A live format other than Markdown that the app can create, as the web's creation menus offer them. */
export interface NewLiveFile {
  format: string
  label: string
  /** The name before the folder makes it unique. */
  name: string
  systemImage: string
}

const NEW_FILES: readonly NewLiveFile[] = [
  { format: 'text', label: 'New Text File', name: 'Untitled.txt', systemImage: 'doc.plaintext' },
  { format: 'document', label: 'New Word Document', name: 'Untitled document.docx', systemImage: 'doc.richtext' },
]

/** The extra "New …" items this app and its server both support. */
export function newLiveFiles(config: MobileConfig | null | undefined): NewLiveFile[] {
  return NEW_FILES.filter((entry) => editorBundleFor(entry.format) && formatSupported(config, entry.format))
}
