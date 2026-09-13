import type { Readable } from 'node:stream'
import type { RequestInit } from 'undici'
import { ControllerRequestError } from './lease-acquisition.js'

interface StagedAttachment { path: string; objectKey: string; mimeType: string; checksum: string | null; sizeBytes: number }

export async function stageWorkspaceAttachments(
  attachments: StagedAttachment[],
  request: (path: string, init?: RequestInit) => Promise<Response>,
  read: (key: string) => Promise<Readable>,
): Promise<void> {
  // Bound metadata requests even for long conversations containing many batches.
  for (let offset = 0; offset < attachments.length; offset += 500) {
    const batch = attachments.slice(offset, offset + 500)
    let missing = new Set(batch.map((file) => file.path))
    try {
      const response = await request('/v1/files/missing', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: batch.map(({ path, checksum, sizeBytes }) => ({ path, checksum, sizeBytes })) }),
      })
      const result = await response.json() as { missing?: unknown }
      if (!Array.isArray(result.missing) || !result.missing.every((path) => typeof path === 'string' && missing.has(path))) throw new Error('Invalid workspace staging inventory')
      missing = new Set(result.missing)
    } catch (error) {
      // Older pinned workspace images can continue to accept ordinary uploads.
      if (!(error instanceof ControllerRequestError) || ![404, 405].includes(error.status)) throw error
    }
    for (const file of batch) {
      if (!missing.has(file.path)) continue
      const source = await read(file.objectKey)
      try {
        const response = await request(`/v1/files?path=${encodeURIComponent(file.path)}`, {
          method: 'PUT', body: source, duplex: 'half', headers: {
            'content-type': file.mimeType, 'content-length': String(file.sizeBytes),
            ...(file.checksum ? { 'x-pulpo-file-checksum': file.checksum } : {}),
          },
        })
        await response.arrayBuffer()
      } finally { source.destroy() }
    }
  }
}
