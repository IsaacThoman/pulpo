import { createHash } from 'node:crypto'
import sharp from 'sharp'

const MAX_INPUT_PIXELS = 40_000_000
const MAX_CACHE_BYTES = 64 * 1024 * 1024

export interface ModelImageRendition {
  data: Buffer
  mimeType: string
  normalized: boolean
}

const cache = new Map<string, ModelImageRendition>()
const inFlight = new Map<string, Promise<ModelImageRendition>>()
let cacheBytes = 0

function imageCacheKey(data: Uint8Array, mimeType: string, sourceChecksum?: string | null): string {
  const checksum = sourceChecksum ?? createHash('sha256').update(data).digest('base64url')
  return `model-image-v1:${mimeType.toLowerCase()}:${checksum}`
}

function cachedImage(key: string): ModelImageRendition | undefined {
  const value = cache.get(key)
  if (!value) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function cacheImage(key: string, value: ModelImageRendition): void {
  if (value.data.byteLength > MAX_CACHE_BYTES) return
  const previous = cache.get(key)
  if (previous) cacheBytes -= previous.data.byteLength
  cache.delete(key)
  cache.set(key, value)
  cacheBytes += value.data.byteLength
  while (cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.entries().next().value as [string, ModelImageRendition] | undefined
    if (!oldest) break
    cache.delete(oldest[0])
    cacheBytes -= oldest[1].data.byteLength
  }
}

function outputMimeType(format: string | undefined, fallback: string): string {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'gif') return 'image/gif'
  return fallback
}

async function renderModelImage(data: Uint8Array, mimeType: string): Promise<ModelImageRendition> {
  const source = Buffer.from(data)
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType.toLowerCase())) {
    return { data: source, mimeType, normalized: false }
  }
  try {
    const options = { animated: false, failOn: 'error' as const, limitInputPixels: MAX_INPUT_PIXELS }
    const metadata = await sharp(source, options).metadata()
    if (!metadata.orientation || metadata.orientation === 1) {
      return { data: source, mimeType, normalized: false }
    }
    let pipeline = sharp(source, options).rotate().keepIccProfile()
    if (metadata.format === 'jpeg') pipeline = pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    else if (metadata.format === 'png') pipeline = pipeline.png({ compressionLevel: 9 })
    else if (metadata.format === 'webp') pipeline = pipeline.webp({ quality: 95, smartSubsample: true })
    else if (metadata.format === 'gif') pipeline = pipeline.gif({ effort: 4 })
    else return { data: source, mimeType, normalized: false }
    const rendered = await pipeline.toBuffer({ resolveWithObject: true })
    return {
      data: rendered.data,
      mimeType: outputMimeType(rendered.info.format, mimeType),
      normalized: true,
    }
  } catch {
    // Preserve pass-through behavior for malformed or provider-supported image
    // variants that Sharp cannot decode. The upstream model can report them.
    return { data: source, mimeType, normalized: false }
  }
}

/** Return full-resolution pixels with EXIF orientation baked into the raster. */
export async function modelImageRendition(
  data: Uint8Array,
  mimeType: string,
  sourceChecksum?: string | null,
): Promise<ModelImageRendition> {
  const key = imageCacheKey(data, mimeType, sourceChecksum)
  const cached = cachedImage(key)
  if (cached) return cached
  const pending = inFlight.get(key)
  if (pending) return pending
  const created = renderModelImage(data, mimeType).then((value) => {
    cacheImage(key, value)
    return value
  }).finally(() => inFlight.delete(key))
  inFlight.set(key, created)
  return created
}
