import type { LiveAssetStore } from '@pulpo/client-core/office'
import { sheetCodec } from '@pulpo/client-core/office/sheets'
import type * as Y from 'yjs'

/** The open workbook as a file, for downloads that include edits not synced yet. */
export async function exportSheetFile(doc: Y.Doc, name: string, assets: LiveAssetStore): Promise<Uint8Array> {
  return sheetCodec.exportFile(doc, { name, assets })
}
