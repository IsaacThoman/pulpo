import sharp, { type Metadata } from 'sharp'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function detectImageMime(bytes: Uint8Array): string | null {
  const buffer = Buffer.from(bytes)
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

/** The long edge Claude's high-resolution vision reads at full detail; GPT and Gemini resize lower. */
export const VIEWED_IMAGE_MAX_EDGE = 2_576
/** Bedrock's per-image limit, and 5 MB once base64 encoded: Anthropic's API limit. */
export const VIEWED_IMAGE_MAX_BYTES = 3_750_000
const MAX_INPUT_PIXELS = 100_000_000

export interface ViewedImage {
  data: Buffer
  mimeType: string
  /** Set when the image was too large for providers and the model sees a smaller copy. */
  resized?: { fromWidth: number; fromHeight: number; width: number; height: number }
}

/**
 * Fit an image the agent views within every provider's image limits. A phone photo can be 7 MB
 * and 4032 px wide: providers reject it or shrink it themselves, and its base64 rides along in
 * every later model call. Images already within the limits pass through byte for byte.
 */
export async function fitViewedImage(bytes: Uint8Array, mimeType: string): Promise<ViewedImage> {
  const source = Buffer.from(bytes)
  const options = { failOn: 'error' as const, limitInputPixels: MAX_INPUT_PIXELS }
  let metadata: Metadata
  try {
    metadata = await sharp(source, options).metadata()
  } catch {
    // Leave undecodable images to the provider, as before.
    return { data: source, mimeType }
  }
  const oriented = (metadata.orientation ?? 1) >= 5
  const fromWidth = (oriented ? metadata.height : metadata.width) ?? 0
  const fromHeight = (oriented ? metadata.width : metadata.height) ?? 0
  if (source.byteLength <= VIEWED_IMAGE_MAX_BYTES && Math.max(fromWidth, fromHeight) <= VIEWED_IMAGE_MAX_EDGE) {
    return { data: source, mimeType }
  }
  for (let edge = VIEWED_IMAGE_MAX_EDGE; ; edge = Math.floor(edge * 0.75)) {
    const pipeline = sharp(source, options).rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    // Photos stay JPEG; anything that may carry transparency becomes WebP, which every vision provider accepts.
    const encoded = mimeType === 'image/jpeg'
      ? pipeline.jpeg({ quality: 85, mozjpeg: true })
      : pipeline.webp({ quality: 85, alphaQuality: 100 })
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
    if (data.byteLength <= VIEWED_IMAGE_MAX_BYTES || edge <= 512) {
      return {
        data,
        mimeType: info.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
        resized: { fromWidth, fromHeight, width: info.width, height: info.height },
      }
    }
  }
}
