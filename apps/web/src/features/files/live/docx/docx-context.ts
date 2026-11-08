import type { DocxContextInfo } from '@pulpo/client-core/office/docx/view'

export interface DocxContextMenuState {
  x: number
  y: number
  info: DocxContextInfo
}

/**
 * Whether right-clicking here gets Pulpo's menu: over a table cell, a picture, a link, or a
 * comment. Elsewhere the browser's own menu stays, with its spelling suggestions. A read-only
 * document has nothing to change in a table or picture, so there the browser's menu stays too
 * (Copy, Copy image, Save image).
 */
export function wantsContextMenu(info: DocxContextInfo | null, editable = true): info is DocxContextInfo {
  return Boolean(info && (info.link || info.comments.length || (editable && info.editable && (info.table || info.picture))))
}
