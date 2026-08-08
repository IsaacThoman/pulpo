import sharp from 'sharp'

const THUMBNAIL_EDGE_PX = 512
const MAX_INPUT_PIXELS = 40_000_000

export async function createAttachmentThumbnail(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' })
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
