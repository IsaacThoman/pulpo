import sharp from 'sharp'
import type { Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const THUMBNAIL_EDGE_PX = 512
const MAX_INPUT_PIXELS = 40_000_000

export async function createAttachmentThumbnail(input: Uint8Array | Readable): Promise<Buffer> {
  // Sharp buffers streamed input internally. Spool to disk before decoding so
  // the compressed file size does not become an equally large heap allocation.
  if (!(input instanceof Uint8Array)) {
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-thumbnail-'))
    try {
      const path = join(directory, 'source')
      await pipeline(input, createWriteStream(path, { flags: 'wx' }))
      return await renderThumbnail(path)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  return renderThumbnail(input)
}

async function renderThumbnail(input: Uint8Array | string): Promise<Buffer> {
  const options = { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' as const }
  const image = sharp(input, options)
  return image
    .rotate()
    .resize({
      width: THUMBNAIL_EDGE_PX,
      height: THUMBNAIL_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4 })
    .toBuffer()
}
