import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { COMPUTER_INLINE_MAX_BYTES, type ComputerParams, type ComputerResult } from '@pulpo/contracts'
import { fileVersion } from './changes'
import { assertSessionActive, ComputerError } from './errors'
import { downloadFile, transferUrl, uploadFile, writeInline } from './transfers'

/** Full access moves files to and from anywhere on the computer (attachments, generated images, attach_file, view_image). */

export interface FileTransferContext {
  origin: string
  allowHttpLocalhost: boolean
  platform: NodeJS.Platform
  /** Whether the session the request came for is still the registered one. */
  active?: () => boolean
}

function absolute(requested: string, platform: NodeJS.Platform): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (requested.includes('\0') || !paths.isAbsolute(requested)) throw new ComputerError('invalid_request', `"${requested}" is not an absolute path.`)
  return paths.resolve(requested)
}

export async function sendFile(context: FileTransferContext, params: ComputerParams<'file.send'>): Promise<ComputerResult<'file.send'>> {
  const file = absolute(params.path, context.platform)
  const metadata = await stat(file)
  if (!metadata.isFile()) throw new ComputerError('invalid_request', `${file} is not a regular file.`)
  if (metadata.size > params.maxBytes) throw new ComputerError('too_large', `${file} has ${metadata.size} bytes, more than the ${params.maxBytes} allowed.`)
  if (metadata.size <= COMPUTER_INLINE_MAX_BYTES) {
    const bytes = await readFile(file)
    if (bytes.byteLength > params.maxBytes) throw new ComputerError('too_large', `${file} grew past the ${params.maxBytes} bytes allowed.`)
    return { sizeBytes: bytes.byteLength, data: bytes.toString('base64') }
  }
  await uploadFile(transferUrl(context.origin, params.transfer.url, context.allowHttpLocalhost), file, metadata.size)
  return { sizeBytes: metadata.size }
}

export async function receiveFile(context: FileTransferContext, params: ComputerParams<'file.receive'>): Promise<ComputerResult<'file.receive'>> {
  const file = absolute(params.path, context.platform)
  const existing = await stat(file).catch(() => null)
  if (existing?.isDirectory()) throw new ComputerError('invalid_request', `${file} is a folder.`)
  const check = { sizeBytes: params.sizeBytes, sha256: params.sha256 }
  // A file that was still arriving when its reply ended is not put in place.
  const stillWanted = () => assertSessionActive(context.active)
  if (params.data !== undefined) await writeInline(params.data, file, check, stillWanted)
  else if (params.transfer) await downloadFile(transferUrl(context.origin, params.transfer.url, context.allowHttpLocalhost), file, check, stillWanted)
  else throw new ComputerError('invalid_request', 'Send the bytes inline or through a transfer.')
  return { path: file }
}

/** Files that are absent or differ in size or hash, so only those are sent. */
export async function missingFiles(context: FileTransferContext, params: ComputerParams<'file.missing'>): Promise<ComputerResult<'file.missing'>> {
  const missing: string[] = []
  for (const entry of params.files) {
    const file = absolute(entry.path, context.platform)
    const metadata = await stat(file).catch(() => null)
    if (!metadata?.isFile() || metadata.size !== entry.sizeBytes) { missing.push(entry.path); continue }
    if (entry.sha256 && await fileVersion(file) !== entry.sha256.toLowerCase()) missing.push(entry.path)
  }
  return { missing }
}
