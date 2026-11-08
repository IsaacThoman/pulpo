import { fileExtension, isMarkdownName, type FileNode } from '@pulpo/contracts'
import { liveFormatOfName } from '@pulpo/client-core/office'
import { ui } from '@/i18n/ui'
import { fileKindLabel } from './file-display'
import { liveWebFormat } from './live/registry'

/** What Details calls a file's type: the editor's kind for documents, the extension otherwise. */
export function fileTypeLabel(node: Pick<FileNode, 'kind' | 'name' | 'format'>): string {
  const web = liveWebFormat(node)
  if (web) {
    const extension = fileExtension(node.name)
    return extension ? ui("{{type}} (.{{extension}})", { type: web.typeLabel(), extension }) : web.typeLabel()
  }
  if (node.kind === 'doc' && (isMarkdownName(node.name) || liveFormatOfName(node.name)?.id === 'markdown')) return ui("Markdown document")
  return fileKindLabel(node)
}
