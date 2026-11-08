/**
 * Natural sizes of images about to be inserted, so pictures keep their aspect ratio. Decoding
 * happens in the browser; where it cannot (Node, a page without image decoding) the size is
 * unknown and the controller falls back to a default box.
 */

export interface ImageSize {
  width: number
  height: number
}

/** The image's size in px, or undefined when it cannot be decoded here. */
export async function imageSize(blob: Blob): Promise<ImageSize | undefined> {
  // createImageBitmap does not take SVG; an <img> does, and reports its intrinsic size.
  if (blob.type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      if (size.width > 0 && size.height > 0) return size
    } catch {
      // Not decodable as a bitmap: try an image element.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    const done = (size: ImageSize | undefined) => {
      URL.revokeObjectURL(url)
      resolve(size)
    }
    image.onload = () => done(image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : undefined)
    image.onerror = () => done(undefined)
    image.src = url
  })
}

/** Whether a drag carries image files (types are all a page can see before the drop). */
export function dragHasImages(transfer: DataTransfer | null): boolean {
  if (!transfer) return false
  const items = Array.from(transfer.items ?? [])
  if (items.length) return items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))
  return Array.from(transfer.types ?? []).includes('Files')
}
