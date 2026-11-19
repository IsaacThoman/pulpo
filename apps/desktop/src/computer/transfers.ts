import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import tls from 'node:tls'
import { COMPUTER_TRANSFER_PATH } from '@pulpo/contracts'
import { ComputerError } from './errors'

/**
 * File bytes travel through one-time URLs. The server only ever sends the path; the origin is the
 * instance the session was begun under, held by the main process, so a request can never point
 * the app at another host. The token in the URL is the only credential: no cookies, no bearer.
 */

const IDLE_TIMEOUT_MS = 60_000
const LOCALHOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function transferUrl(origin: string, transferPath: string, allowHttpLocalhost: boolean): URL {
  const instance = new URL(origin)
  const localhost = LOCALHOSTS.has(instance.hostname)
  if (instance.protocol !== 'https:' && !(allowHttpLocalhost && localhost && instance.protocol === 'http:')) {
    throw new ComputerError('failed', 'Transfers need a secure (https) Pulpo instance.')
  }
  if (!transferPath.startsWith(COMPUTER_TRANSFER_PATH) || transferPath.includes('..') || transferPath.includes('\\')) {
    throw new ComputerError('invalid_request', 'Invalid transfer URL')
  }
  const url = new URL(transferPath, instance.origin)
  if (url.origin !== instance.origin || !url.pathname.startsWith(COMPUTER_TRANSFER_PATH)) throw new ComputerError('invalid_request', 'Invalid transfer URL')
  return url
}

let certificates: string[] | undefined
/** Node's bundled roots plus the system's, so self-hosted instances with a company CA work as they do in the app's own network stack. */
function certificateAuthorities(): string[] | undefined {
  if (certificates) return certificates
  try {
    const system = tls.getCACertificates('system')
    certificates = [...new Set([...tls.getCACertificates('default'), ...system])]
  } catch { return undefined }
  return certificates
}

function request(url: URL, method: 'GET' | 'PUT', headers: Record<string, string | number>): http.ClientRequest {
  const options: https.RequestOptions = { method, headers, timeout: IDLE_TIMEOUT_MS }
  if (url.protocol === 'https:') {
    const ca = certificateAuthorities()
    return https.request(url, ca ? { ...options, ca } : options)
  }
  return http.request(url, options)
}

function failure(response: http.IncomingMessage, what: string): ComputerError {
  response.resume()
  return new ComputerError('failed', `The ${what} was refused by Pulpo (HTTP ${response.statusCode ?? 0}).`)
}

/** Streams a file to the transfer URL with PUT. `meter` sees every chunk (for hashing). */
export async function uploadFile(url: URL, file: string, sizeBytes: number, meter?: (chunk: Buffer) => void): Promise<void> {
  const outgoing = request(url, 'PUT', { 'content-type': 'application/octet-stream', 'content-length': sizeBytes })
  const answered = new Promise<http.IncomingMessage>((resolve, reject) => {
    outgoing.once('response', resolve)
    outgoing.once('error', reject)
    outgoing.once('timeout', () => outgoing.destroy(new ComputerError('failed', 'The upload to Pulpo stalled.')))
  })
  let sent = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sent += chunk.byteLength
      meter?.(chunk)
      callback(sent <= sizeBytes ? null : new ComputerError('failed', 'The file changed while it was being sent.'), chunk)
    },
    flush(callback) { callback(sent === sizeBytes ? null : new ComputerError('failed', 'The file changed while it was being sent.')) },
  })
  try {
    await pipeline(createReadStream(file), counter, outgoing)
  } catch (error) {
    outgoing.destroy()
    answered.catch(() => undefined)
    throw error
  }
  const response = await answered
  if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) throw failure(response, 'upload')
  response.resume()
}

export interface DownloadCheck { sizeBytes: number; sha256?: string }

/** Verifies size and checksum while bytes pass, failing as soon as there are too many. */
function verifier(check: DownloadCheck): { stream: Transform; finish: () => string } {
  const hash = createHash('sha256')
  let received = 0
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength
      hash.update(chunk)
      callback(received <= check.sizeBytes ? null : new ComputerError('failed', 'The file from Pulpo is larger than announced.'), chunk)
    },
  })
  return {
    stream,
    finish: () => {
      if (received !== check.sizeBytes) throw new ComputerError('failed', `The file from Pulpo has ${received} bytes, not the ${check.sizeBytes} announced.`)
      const digest = hash.digest('hex')
      if (check.sha256 && check.sha256 !== digest) throw new ComputerError('failed', 'The file from Pulpo does not match its checksum.')
      return digest
    },
  }
}

/** A hidden temporary name beside the target, so the final rename stays on one volume. */
export function temporarySibling(target: string): string {
  return path.join(path.dirname(target), `.${randomBytes(6).toString('hex')}.pulpo-part`)
}

/** Writes a stream to `target` through a temporary file, verified before it is renamed into place. Returns the hex SHA-256. */
export async function writeVerified(source: Readable, target: string, check: DownloadCheck, beforeCommit?: () => void): Promise<string> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = temporarySibling(target)
  const { stream, finish } = verifier(check)
  try {
    await pipeline(source, stream, createWriteStream(temporary, { flags: 'wx' }))
    const digest = finish()
    // The bytes may have taken a while; a caller can still call the write off (it throws).
    beforeCommit?.()
    await rename(temporary, target)
    return digest
  } catch (error) {
    source.destroy()
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Fetches the transfer URL with GET into `target` (temporary name, then rename). */
export async function downloadFile(url: URL, target: string, check: DownloadCheck, beforeCommit?: () => void): Promise<string> {
  const incoming = request(url, 'GET', {})
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    incoming.once('response', resolve)
    incoming.once('error', reject)
    incoming.once('timeout', () => incoming.destroy(new ComputerError('failed', 'The download from Pulpo stalled.')))
    incoming.end()
  })
  if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) throw failure(response, 'download')
  return writeVerified(response, target, check, beforeCommit)
}

/** Writes inline base64 bytes to `target` the same way. */
export async function writeInline(data: string, target: string, check: DownloadCheck, beforeCommit?: () => void): Promise<string> {
  return writeVerified(Readable.from([Buffer.from(data, 'base64')]), target, check, beforeCommit)
}
