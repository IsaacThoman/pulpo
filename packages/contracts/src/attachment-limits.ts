export const MAX_MESSAGE_ATTACHMENTS = 500
export const DEFAULT_MAX_INLINE_IMAGES = 5
export const MAX_CONFIGURABLE_INLINE_IMAGES = 20
export const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024

/** Large image batches remain available as workspace files for on-demand inspection. */
export function imageBatchNeedsWorkspace(
  images: readonly { sizeBytes?: number }[],
  maxInlineImages = DEFAULT_MAX_INLINE_IMAGES,
): boolean {
  return images.length > maxInlineImages
    || images.reduce((sum, image) => sum + (image.sizeBytes ?? 0), 0) > MAX_INLINE_IMAGE_BYTES
}
