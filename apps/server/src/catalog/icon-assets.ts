import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const CATALOG_ICON_MAX_BYTES = 2 * 1024 * 1024
export const CATALOG_ICON_MAX_PIXELS = 16_000_000
export const CATALOG_ICON_EDGE_PX = 256
export const CATALOG_ICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

const CATALOG_ICON_FORMAT_BY_MIME_TYPE: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
])

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

function validateSvgSource(bytes: Uint8Array): void {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('SVG catalog icons must use UTF-8 encoding')
  }

  if (/<!\s*(?:doctype|entity)\b/i.test(source)) {
    throw new Error('SVG catalog icons may not contain document type or entity declarations')
  }
  if (/<\s*(?:(?:[a-z_][\w.-]*):)?(?:script|foreignobject|iframe|object|embed|image|feimage|include)\b/i.test(source)) {
    throw new Error('SVG catalog icons may not contain active or embedded content')
  }
  if (/\s(?:on[a-z][\w:.-]*)\s*=/i.test(source) || /@import\b/i.test(source)) {
    throw new Error('SVG catalog icons may not contain scripts or imported styles')
  }

  for (const match of source.matchAll(/\b(?:(?:[a-z_][\w.-]*):)?href\s*=\s*(["'])(.*?)\1/gi)) {
    const reference = match[2]?.trim() ?? ''
    if (reference && !reference.startsWith('#')) {
      throw new Error('SVG catalog icons may only reference elements inside the same document')
    }
  }
  for (const match of source.matchAll(/url\s*\(\s*([^)]*?)\s*\)/gi)) {
    const reference = (match[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim()
    if (!reference.startsWith('#')) {
      throw new Error('SVG catalog icons may only reference elements inside the same document')
    }
  }
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
  const mimeType = declaredMimeType.split(';', 1)[0]!.trim().toLowerCase()
  const expectedFormat = CATALOG_ICON_FORMAT_BY_MIME_TYPE.get(mimeType)
  if (!CATALOG_ICON_MIME_TYPES.has(mimeType) || !expectedFormat) {
    throw new Error('Catalog icons must be PNG, JPEG, WebP, or SVG images')
  }
  if (!bytes.byteLength || bytes.byteLength > CATALOG_ICON_MAX_BYTES) {
    throw new Error(`Catalog icons must be between 1 byte and ${CATALOG_ICON_MAX_BYTES} bytes`)
  }

  if (expectedFormat === 'svg') validateSvgSource(bytes)

  const options = {
    animated: false,
    failOn: 'error',
    limitInputPixels: CATALOG_ICON_MAX_PIXELS,
  } as const
  const metadata = await sharp(bytes, options).metadata()
  if (metadata.format !== expectedFormat) {
    throw new Error('Catalog icon contents do not match an accepted image format')
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > CATALOG_ICON_MAX_PIXELS) {
    throw new Error('Catalog icons may contain at most 16 megapixels')
  }

  const density = expectedFormat === 'svg'
    ? Math.max(72, (CATALOG_ICON_EDGE_PX * 72) / Math.max(metadata.width, metadata.height))
    : undefined
  const input = sharp(bytes, { ...options, density })

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
