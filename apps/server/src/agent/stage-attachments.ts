import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { RequestInit } from 'undici'
import { ControllerRequestError } from './lease-acquisition.js'

interface StagedAttachment { path: string; objectKey: string; mimeType: string; checksum: string | null; sizeBytes: number }

export async function stageWorkspaceAttachments(
  attachments: StagedAttachment[],
  request: (path: string, init?: RequestInit) => Promise<Response>,
  read: (key: string) => Promise<Readable>,
  options: { preserveExisting?: boolean } = {},
): Promise<void> {
  // Bound metadata requests even for long conversations containing many batches.
  for (let offset = 0; offset < attachments.length; offset += 500) {
    const batch = attachments.slice(offset, offset + 500)
    let preservationSupported = false
    let missing = new Set(batch.map((file) => file.path))
    try {
      const response = await request('/v1/files/missing', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preserveExisting: options.preserveExisting === true, files: batch.map(({ path, checksum, sizeBytes }) => ({ path, checksum, sizeBytes })) }),
      })
      const result = await response.json() as { missing?: unknown; preserveExisting?: boolean }
      if (!Array.isArray(result.missing) || !result.missing.every((path) => typeof path === 'string' && missing.has(path))) throw new Error('Invalid workspace staging inventory')
      missing = new Set(result.missing)
      preservationSupported = result.preserveExisting === true
    } catch (error) {
      // Older pinned workspace images can continue to accept ordinary uploads.
      if (!(error instanceof ControllerRequestError) || ![404, 405].includes(error.status)) throw error
    }
    for (const file of batch) {
      if (!missing.has(file.path)) continue
      if (options.preserveExisting && !preservationSupported) {
        // Old pinned daemons support stat operations even without preservation-aware inventory.
        const operationId = `stage-stat-${randomUUID()}`
        const signal = AbortSignal.timeout(10_000)
        const response = await request('/v1/operations', { method: 'POST', signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: operationId, type: 'stat', args: { path: file.path } }) })
        let operation = await response.json() as { status: string; error?: string }
        while (operation.status === 'running') {
          signal.throwIfAborted()
          await new Promise(resolve => setTimeout(resolve, 50))
          operation = await (await request(`/v1/operations/${operationId}`, { signal })).json() as typeof operation
        }
        if (operation.status === 'completed') continue
        if (operation.status !== 'failed' || !operation.error?.startsWith('ENOENT:')) throw new Error(operation.error ?? 'Unable to inspect existing workspace file')
      }
      const source = await read(file.objectKey)
      try {
        const response = await request(`/v1/files?path=${encodeURIComponent(file.path)}`, {
          method: 'PUT', body: source, duplex: 'half', headers: {
            'content-type': file.mimeType, 'content-length': String(file.sizeBytes),
            ...(options.preserveExisting ? { 'if-none-match': '*' } : {}),
            ...(file.checksum ? { 'x-pulpo-file-checksum': file.checksum } : {}),
          },
        })
        await response.arrayBuffer()
      } finally { source.destroy() }
    }
  }
}
