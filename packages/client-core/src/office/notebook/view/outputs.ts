import type { LiveAssetStore } from '../../live-format.js'
import { blobNode } from '../file.js'
import { JUPYTER_STYLE, jsonValue } from '../json.js'
import type { NotebookBlob } from '../layout.js'
import { normalizeAttachments, normalizeOutputs, type MimeBundle, type NotebookOutput } from '../model.js'

/**
 * Outputs and attachments as viewers show them: their assets read back (images as base64 again, so
 * the notebook viewer's renderers take them as they are) and normalized like any notebook's.
 */

/** A blob's JSON with its assets put back. */
export async function readBlob(blob: NotebookBlob, assets: LiveAssetStore): Promise<unknown> {
  return jsonValue(await blobNode(blob, assets, JUPYTER_STYLE))
}

export async function readOutputs(blob: NotebookBlob, assets: LiveAssetStore): Promise<NotebookOutput[]> {
  return normalizeOutputs(await readBlob(blob, assets))
}

export async function readAttachments(blob: NotebookBlob | null, assets: LiveAssetStore): Promise<Record<string, MimeBundle>> {
  return blob ? normalizeAttachments(await readBlob(blob, assets)) : {}
}
