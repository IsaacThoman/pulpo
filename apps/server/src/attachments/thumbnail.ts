import sharp from 'sharp'
import type { Readable } from 'node:stream'

const THUMBNAIL_EDGE_PX = 512
const MAX_INPUT_PIXELS = 40_000_000

export async function createAttachmentThumbnail(input: Uint8Array | Readable): Promise<Buffer> {
  const options = { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' as const }
  const image = input instanceof Uint8Array ? sharp(input, options) : sharp(options)
  if (!(input instanceof Uint8Array)) {
    input.on('error', (error) => image.destroy(error))
    input.pipe(image)
  }
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
