import sharp from 'sharp'
import { AppError } from '../lib/errors.js'

export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024
const PROFILE_AVATAR_MAX_PIXELS = 25_000_000
const PROFILE_AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp'])

export async function normalizeProfileAvatar(bytes: Uint8Array, declaredMimeType: string): Promise<Buffer> {
  const mimeType = declaredMimeType.split(';', 1)[0]!.trim().toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new AppError(400, 'invalid_avatar', 'Profile pictures must be JPEG, PNG, or WebP images')
  }
  if (!bytes.byteLength || bytes.byteLength > PROFILE_AVATAR_MAX_BYTES) {
    throw new AppError(413, 'avatar_too_large', 'Profile pictures may be at most 5 MiB')
  }
  try {
    const metadata = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: PROFILE_AVATAR_MAX_PIXELS }).metadata()
    if (!metadata.format || !PROFILE_AVATAR_FORMATS.has(metadata.format)) {
      throw new Error('Unsupported image format')
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > PROFILE_AVATAR_MAX_PIXELS) {
      throw new Error('Profile pictures may contain at most 25 megapixels')
    }
    return sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: PROFILE_AVATAR_MAX_PIXELS })
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88, effort: 5 })
      .toBuffer()
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError(400, 'invalid_avatar', cause instanceof Error ? cause.message : 'Profile picture is invalid')
  }
}
