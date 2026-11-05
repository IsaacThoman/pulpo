import type { LiveAssetStore } from '@pulpo/client-core/office'
import { sheetCodec } from '@pulpo/client-core/office/sheets'
import type * as Y from 'yjs'

const editors = new WeakMap<Y.Doc, { settleEdit(): boolean }>()

/** Registers the open view so local exports include the text still being typed. */
export function registerSheetEditor(doc: Y.Doc, editor: { settleEdit(): boolean }): () => void {
  editors.set(doc, editor)
  return () => {
    if (editors.get(doc) === editor) editors.delete(doc)
  }
}

/** The open workbook as a file, for downloads that include edits not synced yet. */
export async function exportSheetFile(doc: Y.Doc, name: string, assets: LiveAssetStore): Promise<Uint8Array> {
  editors.get(doc)?.settleEdit()
  return sheetCodec.exportFile(doc, { name, assets })
}
