import sharp from 'sharp'
import { avatarCropSettingsSchema, avatarDrawRect, type AvatarCropSettings } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'

export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024
const PROFILE_AVATAR_MAX_PIXELS = 25_000_000
const PROFILE_AVATAR_MAX_FRAMES = 100
const AVATAR_SIZE = 512
const PROFILE_AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif'])
const circleMask = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>')
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

export function parseProfileAvatarCrop(value: unknown = undefined): AvatarCropSettings | undefined {
  if (value === undefined) return undefined
  try {
    if (typeof value !== 'string') throw new Error('Expected JSON')
    return avatarCropSettingsSchema.parse(JSON.parse(value))
  } catch (cause) {
    const error = new AppError(400, 'invalid_avatar_crop', 'Invalid profile picture crop: use a boolean cropToCircle, zoom from 1 to 3, and finite offsets')
    error.cause = cause
    throw error
  }
}

async function transformFrame(frame: Buffer, width: number, height: number, crop?: AvatarCropSettings): Promise<Buffer> {
  let image = sharp(frame, { raw: { width, height, channels: 4 } })
  if (crop?.cropToCircle) {
    const rect = avatarDrawRect(width, height, crop)
    const scale = rect.width / width
    // Crop in source coordinates before resizing, avoiding enormous intermediate images.
    const side = Math.max(1, Math.min(width, height, Math.round(AVATAR_SIZE / scale)))
    const left = Math.max(0, Math.min(width - side, Math.round(-rect.x / scale)))
    const top = Math.max(0, Math.min(height - side, Math.round(-rect.y / scale)))
    image = image.extract({ left, top, width: side, height: side })
      .resize(AVATAR_SIZE, AVATAR_SIZE)
      .composite([{ input: circleMask, blend: 'dest-in' }])
  } else {
    image = image.resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: crop ? 'contain' : 'cover', position: 'centre', background: transparent,
    })
  }
  return image.raw().toBuffer()
}

export async function normalizeProfileAvatar(bytes: Uint8Array, declaredMimeType: string, crop?: AvatarCropSettings): Promise<Buffer> {
  const mimeType = declaredMimeType.split(';', 1)[0]!.trim().toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
    throw new AppError(400, 'invalid_avatar', 'Profile pictures must be JPEG, PNG, WebP, or GIF images')
  }
  if (!bytes.byteLength || bytes.byteLength > PROFILE_AVATAR_MAX_BYTES) {
    throw new AppError(413, 'avatar_too_large', 'Profile pictures may be at most 5 MiB')
  }
  try {
    const options = { animated: true, failOn: 'error' as const, limitInputPixels: PROFILE_AVATAR_MAX_PIXELS }
    const metadata = await sharp(bytes, options).metadata()
    if (!metadata.format || !PROFILE_AVATAR_FORMATS.has(metadata.format)) throw new Error('Unsupported image format')
    const pages = metadata.pages ?? 1
    if (pages > PROFILE_AVATAR_MAX_FRAMES) throw new Error('Animated profile pictures may contain at most 100 frames')
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > PROFILE_AVATAR_MAX_PIXELS) {
      throw new Error('Profile pictures may contain at most 25 million pixels across all frames')
    }
    if (pages === 1 && !crop) {
      return await sharp(bytes, options).rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
        .webp({ quality: 88, effort: 5 }).toBuffer()
    }

    // Decode the entire animation first so GIF disposal and partial frames are resolved.
    let decoder = sharp(bytes, options)
    if (pages === 1) decoder = decoder.rotate()
    const { data, info } = await decoder.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const height = info.height / pages
    const frameBytes = info.width * height * 4
    const frames: Buffer[] = []
    for (let page = 0; page < pages; page++) {
      frames.push(await transformFrame(data.subarray(page * frameBytes, (page + 1) * frameBytes), info.width, height, crop))
    }
    return await sharp(Buffer.concat(frames), {
      raw: { width: AVATAR_SIZE, height: AVATAR_SIZE * pages, channels: 4, pageHeight: AVATAR_SIZE },
    }).webp({ quality: 88, effort: 5, loop: metadata.loop, delay: metadata.delay }).toBuffer()
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError(400, 'invalid_avatar', cause instanceof Error ? cause.message : 'Profile picture is invalid')
  }
}
