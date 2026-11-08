import type { LiveAssetStore } from '@pulpo/client-core/office'
import { sheetCodec, WorkbookModel } from '@pulpo/client-core/office/sheets'
import * as Y from 'yjs'

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

/**
 * One sheet of the open workbook as CSV or TSV (by `name`'s extension), as Sheets' "current sheet"
 * downloads. The codec writes the workbook's recorded active sheet, which the view never updates,
 * so a private copy records `sheetId` instead: the shared document is left as it is.
 */
export async function exportSheetAsText(doc: Y.Doc, sheetId: string, name: string, assets: LiveAssetStore): Promise<Uint8Array> {
  editors.get(doc)?.settleEdit()
  const copy = new Y.Doc()
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    new WorkbookModel(copy).setMeta('activeSheet', sheetId)
    return await sheetCodec.exportFile(copy, { name, assets })
  } finally {
    copy.destroy()
  }
}
