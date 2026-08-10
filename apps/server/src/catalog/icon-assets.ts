import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const CATALOG_ICON_MAX_BYTES = 2 * 1024 * 1024
export const CATALOG_ICON_MAX_PIXELS = 16_000_000
export const CATALOG_ICON_EDGE_PX = 256
export const CATALOG_ICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface CatalogIconVariants {
  original: Buffer
  monochromeLight: Buffer
  monochromeDark: Buffer
  checksums: {
    original: string
    monochromeLight: string
    monochromeDark: string
  }
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function solidWithAlpha(alpha: Buffer, value: number): Promise<Buffer> {
  return sharp({
    create: {
      width: CATALOG_ICON_EDGE_PX,
      height: CATALOG_ICON_EDGE_PX,
      channels: 3,
      background: { r: value, g: value, b: value },
    },
  })
    .joinChannel(alpha, { raw: { width: CATALOG_ICON_EDGE_PX, height: CATALOG_ICON_EDGE_PX, channels: 1 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

export async function createCatalogIconVariants(bytes: Uint8Array, declaredMimeType: string): Promise<CatalogIconVariants> {
  if (!CATALOG_ICON_MIME_TYPES.has(declaredMimeType.toLowerCase())) {
    throw new Error('Catalog icons must be PNG, JPEG, or WebP images')
  }
  if (!bytes.byteLength || bytes.byteLength > CATALOG_ICON_MAX_BYTES) {
    throw new Error(`Catalog icons must be between 1 byte and ${CATALOG_ICON_MAX_BYTES} bytes`)
  }

  const input = sharp(bytes, {
    animated: false,
    failOn: 'error',
    limitInputPixels: CATALOG_ICON_MAX_PIXELS,
  })
  const metadata = await input.metadata()
  if (!metadata.format || !['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw new Error('Catalog icon contents do not match an accepted image format')
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > CATALOG_ICON_MAX_PIXELS) {
    throw new Error('Catalog icons may contain at most 16 megapixels')
  }

  const original = await input
    .rotate()
    .resize({
      width: CATALOG_ICON_EDGE_PX,
      height: CATALOG_ICON_EDGE_PX,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
  const alpha = await sharp(original).extractChannel('alpha').raw().toBuffer()
  const [monochromeLight, monochromeDark] = await Promise.all([
    solidWithAlpha(alpha, 0),
    solidWithAlpha(alpha, 255),
  ])

  return {
    original,
    monochromeLight,
    monochromeDark,
    checksums: {
      original: checksum(original),
      monochromeLight: checksum(monochromeLight),
      monochromeDark: checksum(monochromeDark),
    },
  }
}
