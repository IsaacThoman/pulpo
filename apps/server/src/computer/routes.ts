import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { COMPUTER_TRANSFER_PATH } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import { AttachmentSizeMismatchError, exactSizeStream } from '../attachments/streams.js'
import {
  claimComputerTransfer, completeComputerTransfer, computerTransferObjectKey, findComputerTransfer, releaseComputerTransferClaim,
} from './transfers.js'

const transferRequest = z.object({ id: z.uuid() })
const transferQuery = z.object({ token: z.string().min(1).max(200) })

// One status for unknown, expired, wrong-token and wrong-direction transfers, so a guess learns nothing.
const notFound = () => new AppError(404, 'transfer_not_found', 'This transfer does not exist or has expired')
const used = () => new AppError(409, 'transfer_used', 'This transfer was already used')

function parseTransfer(request: { params: unknown; query: unknown }) {
  const params = transferRequest.safeParse(request.params)
  const query = transferQuery.safeParse(request.query)
  if (!params.success || !query.success) throw notFound()
  return { id: params.data.id, token: query.data.token }
}

/** For request logs: the token in a transfer URL is its only credential. */
export function redactComputerTransferToken(url: string): string {
  return url.startsWith(COMPUTER_TRANSFER_PATH) ? url.replace(/([?&]token=)[^&]*/, '$1[redacted]') : url
}

/**
 * The one-time URLs the desktop app's main process moves file bytes through. The token in the URL
 * is the only credential: these routes read no session, so cookies and the origin check play no
 * part, and they stream bytes to and from the blob store without holding a file in memory.
 */
export async function registerComputerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    // Any content type: the body is passed on as the raw stream, and the size limit is the transfer's.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_request, payload, done) => done(null, payload))
    // A pull moves up to COMPUTER_PULL_MAX_FILES files from one address; the token already resists guessing.
    const routeOptions = { compress: false as const, config: { rateLimit: { max: 2_000, timeWindow: '1 minute' } } }
    const path = `${COMPUTER_TRANSFER_PATH}:id`

    scope.put(path, routeOptions, async (request, reply) => {
      const { id, token } = parseTransfer(request)
      const header = request.headers['content-length']
      if (typeof header !== 'string' || !/^\d+$/.test(header)) {
        throw new AppError(411, 'length_required', 'Send the file with a Content-Length header')
      }
      const sizeBytes = Number(header)
      const record = await findComputerTransfer(id, token, 'upload')
      if (!record) throw notFound()
      if (sizeBytes > record.maxBytes) throw new AppError(413, 'transfer_too_large', `The file is larger than ${record.maxBytes} bytes`)
      if (!await claimComputerTransfer(id, record)) throw used()
      const body = request.body instanceof Readable ? request.body : Readable.from([])
      const key = computerTransferObjectKey(id)
      try {
        await getBlobStore().putStream(key, exactSizeStream(body, sizeBytes), { contentType: 'application/octet-stream', contentLength: sizeBytes })
      } catch (cause) {
        await getBlobStore().delete(key).catch(() => undefined)
        await releaseComputerTransferClaim(id)
        if (cause instanceof AttachmentSizeMismatchError) throw new AppError(400, 'transfer_size_mismatch', 'The body does not match its Content-Length')
        throw cause
      }
      if (!await completeComputerTransfer(id, sizeBytes)) {
        // Disposed while the bytes arrived: nobody will read them.
        await getBlobStore().delete(key).catch(() => undefined)
        throw notFound()
      }
      reply.code(204).send()
    })

    scope.get(path, routeOptions, async (request, reply) => {
      const { id, token } = parseTransfer(request)
      const record = await findComputerTransfer(id, token, 'download')
      if (!record || record.sizeBytes === null) throw notFound()
      if (!await claimComputerTransfer(id, record)) throw used()
      const stream = await getBlobStore().getStream(computerTransferObjectKey(id))
      reply.header('content-length', String(record.sizeBytes)).header('cache-control', 'no-store').type('application/octet-stream')
      return reply.send(stream)
    })
  })
}
