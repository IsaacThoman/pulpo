import type { DocxContextInfo } from '@pulpo/client-core/office/docx/view'

export interface DocxContextMenuState {
  x: number
  y: number
  info: DocxContextInfo
}

/**
 * Whether right-clicking here gets Pulpo's menu: over a table cell, a picture, a link, or a
 * comment. Elsewhere the browser's own menu stays, with its spelling suggestions.
 */
export function wantsContextMenu(info: DocxContextInfo | null): info is DocxContextInfo {
  return Boolean(info && (info.table || info.picture || info.link || info.comments.length))
}
