import * as Y from 'yjs'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { blankDocx } from './blank.js'
import { exportDocx, fingerprintParts } from './export.js'
import { importDocx } from './import.js'
import { readDocxMap, readDocxModel, writeDocxModel, type DocxModel } from './model.js'
import { MIME_TYPES } from './names.js'
import { docxToText } from './text.js'

/** Bump when the Y.Doc layout or the schema changes in a way older clients would misread. */
export const DOCX_SCHEMA_VERSION = 1

const EXTENSIONS = ['docx', 'dotx', 'docm', 'dotm'] as const

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  const extension = index < 0 ? '' : name.slice(index + 1).toLowerCase()
  return (EXTENSIONS as readonly string[]).includes(extension) ? extension : 'docx'
}

/** Imports bytes into a model with fingerprints of its regenerated parts. */
async function importWithFingerprints(bytes: Uint8Array, context: LiveFormatContext): Promise<DocxModel> {
  const model = await importDocx(bytes, context.assets)
  for (const [path, hash] of await fingerprintParts(model, context.assets)) model.maps.docx.set(`fingerprint:${path}`, hash)
  model.maps.docx.set('schemaVersion', String(DOCX_SCHEMA_VERSION))
  return model
}

function withCurrentRegeneratedParts(doc: Y.Doc, model: DocxModel): DocxModel {
  const currentParts = readDocxMap(doc, 'parts')
  const currentMeta = readDocxMap(doc, 'docx')
  const parts = new Map(model.maps.parts)
  const docx = new Map([...model.maps.docx].filter(([key]) => !key.startsWith('fingerprint:')))
  for (const [key, value] of currentMeta) if (key.startsWith('fingerprint:')) docx.set(key, value)
  const regenerated = new Set([...model.maps.docx.keys(), ...currentMeta.keys()].filter((key) => key.startsWith('fingerprint:')).map((key) => key.slice('fingerprint:'.length)))
  for (const path of regenerated) {
    const current = currentParts.get(path)
    if (current !== undefined) parts.set(path, current)
    else parts.delete(path)
  }
  return { ...model, maps: { ...model.maps, parts, docx } }
}

function assertEmpty(doc: Y.Doc): void {
  if (doc.getXmlFragment('body').length || doc.getMap('parts').size) throw new LiveFormatError('corrupt', 'The document is not empty')
}

/**
 * Word documents (.docx, and .dotx/.docm/.dotm, whose macros are kept as bytes but never run).
 * See `model.ts` for the Y.Doc layout and `docs/office-documents.md` for what is modeled.
 */
export const docxCodec: LiveFormatCodec = {
  id: 'document',
  schemaVersion: DOCX_SCHEMA_VERSION,
  extensions: EXTENSIONS,
  mimeType(extension) {
    return MIME_TYPES[extension.toLowerCase() as keyof typeof MIME_TYPES] ?? MIME_TYPES.docx
  },
  async createEmpty(doc, context) {
    assertEmpty(doc)
    const model = await importWithFingerprints(blankDocx(), context)
    doc.transact(() => { writeDocxModel(doc, model) })
  },
  async importFile(doc, bytes, context) {
    assertEmpty(doc)
    const model = await importWithFingerprints(bytes, context)
    doc.transact(() => { writeDocxModel(doc, model) })
  },
  async exportFile(doc, context) {
    return exportDocx(readDocxModel(doc), context.assets, extensionOf(context.name))
  },
  async applyFile(doc, bytes, context, origin) {
    const model = await importWithFingerprints(bytes, context)
    let changed = false
    doc.transact(() => {
      // The bytes of parts the model regenerates only matter when content changed: a file that
      // reads the same must not count as a change because the earlier export was regenerated.
      changed = writeDocxModel(doc, withCurrentRegeneratedParts(doc, model))
      if (changed) writeDocxModel(doc, model)
    }, origin)
    return { changed }
  },
  toText(doc) {
    return docxToText(readDocxModel(doc))
  },
}
