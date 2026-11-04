import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { canExportOfficePdf, convertedFileName, fileExtension, officeConversionTarget, type FileNode, type OfficeEditableFormat } from '@pulpo/contracts'
import { attachmentSizeError } from '../../attachments/storage-quota.js'
import { db } from '../../database/client.js'
import { applicationSettings, fileNodes } from '../../database/schema.js'
import { AppError, notFound } from '../../lib/errors.js'
import { newId } from '../../lib/ids.js'
import { parseAuthSettings } from '../../settings/application-settings.js'
import { getBlobStore } from '../../storage/index.js'
import { resolveFileAccess, type FileExecutor, type FileNodeRow } from '../access.js'
import { deleteUnlessCommitted } from '../agent/commit.js'
import { storeBlob } from '../agent/versions.js'
import { topSortOrder } from '../order.js'
import { assertDestination, availableName, mutateFileTree, toFileNode } from '../tree-service.js'
import { convertOfficeDocument, OFFICE_CONVERTER_MAX_INPUT_BYTES, officeConversionAvailable, withConversionSlot } from './converter.js'

export async function readStoredObject(key: string): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of await getBlobStore().getStream(key) as Readable) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

/** Converted files obey the same per-file cap as uploads. */
export async function assertConvertedSizeAllowed(executor: FileExecutor, sizeBytes: number): Promise<void> {
  const [setting] = await executor.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
  const error = attachmentSizeError(sizeBytes, parseAuthSettings(setting?.value).maxAttachmentBytes)
  if (error) throw new AppError(413, 'office_file_too_large', `The converted file is too large to keep in Files. ${error}`)
}

async function readableOfficeFile(userId: string, id: string): Promise<FileNodeRow & { objectKey: string }> {
  if (!officeConversionAvailable()) throw new AppError(404, 'office_conversion_unavailable', 'Converting office files is not available on this server')
  const node = (await resolveFileAccess(db, userId, id))?.node
  if (!node || node.trashedAt || node.kind !== 'blob' || node.status !== 'ready' || !node.objectKey) throw notFound('File')
  if (node.sizeBytes > OFFICE_CONVERTER_MAX_INPUT_BYTES) throw new AppError(413, 'office_file_too_large', 'This file is too large to convert')
  return node as FileNodeRow & { objectKey: string }
}

/** The file as PDF, for download or preview. Nothing is stored. */
export async function exportFileAsPdf(userId: string, id: string, signal?: AbortSignal): Promise<{ name: string; bytes: Uint8Array }> {
  const node = await readableOfficeFile(userId, id)
  if (!canExportOfficePdf(node.name)) throw new AppError(400, 'office_conversion_unsupported', 'Only office documents can be exported as PDF')
  return withConversionSlot(userId, async () => ({
    name: convertedFileName(node.name, 'pdf'),
    bytes: await convertOfficeDocument({ bytes: await readStoredObject(node.objectKey), from: fileExtension(node.name), to: 'pdf', signal }),
  }))
}

/**
 * Converts an office file into its editable format as a new file beside it ("Report.doc" gets
 * "Report.docx", or the next free name), keeping the original. The bytes are stored first and
 * deleted again unless the new file commits.
 */
export async function convertFileToEditable(userId: string, id: string, to: OfficeEditableFormat, signal?: AbortSignal): Promise<FileNode> {
  const node = await readableOfficeFile(userId, id)
  if (officeConversionTarget(node.name) !== to) throw new AppError(400, 'office_conversion_unsupported', `This file cannot be converted to .${to}`)
  const converted = await withConversionSlot(userId, async () =>
    convertOfficeDocument({ bytes: await readStoredObject(node.objectKey), from: fileExtension(node.name), to, signal }))
  await assertConvertedSizeAllowed(db, converted.byteLength)
  const content = await storeBlob(userId, convertedFileName(node.name, to), converted)
  try {
    return await mutateFileTree(userId, async (tx) => {
      // The original may have moved, been renamed, or been trashed while it converted.
      const current = (await resolveFileAccess(tx, userId, id))?.node
      if (!current || current.trashedAt) throw notFound('File')
      await assertDestination(tx, userId, current.parentId)
      const name = await availableName(tx, userId, current.parentId, convertedFileName(current.name, to))
      const [row] = await tx.insert(fileNodes).values({
        id: newId(), ownerUserId: userId, parentId: current.parentId, kind: 'blob', name, ...content,
        status: 'ready', sortOrder: await topSortOrder(tx, userId, current.parentId),
      }).returning()
      return toFileNode(row!)
    }, ['files', 'folders'], { reserveBytes: converted.byteLength })
  } catch (error) {
    await deleteUnlessCommitted(content.objectKey)
    throw error
  }
}
