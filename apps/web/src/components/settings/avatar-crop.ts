export interface AvatarCropSettings {
  cropToCircle: boolean
  zoom: number
  offsetX: number
  offsetY: number
}

export const DEFAULT_AVATAR_CROP: AvatarCropSettings = {
  cropToCircle: true,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
}

export interface AvatarDrawRect {
  x: number
  y: number
  width: number
  height: number
}

export function avatarDrawRect(
  imageWidth: number,
  imageHeight: number,
  settings: AvatarCropSettings,
  canvasSize = 512,
): AvatarDrawRect {
  const scale = settings.cropToCircle
    ? Math.max(canvasSize / imageWidth, canvasSize / imageHeight) * settings.zoom
    : Math.min(canvasSize / imageWidth, canvasSize / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  const maxOffsetX = settings.cropToCircle ? Math.max(0, (width - canvasSize) / 2) : 0
  const maxOffsetY = settings.cropToCircle ? Math.max(0, (height - canvasSize) / 2) : 0
  const offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, settings.offsetX))
  const offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, settings.offsetY))
  return {
    x: (canvasSize - width) / 2 + offsetX,
    y: (canvasSize - height) / 2 + offsetY,
    width,
    height,
  }
}

export async function prepareAvatarFile(file: File, settings: AvatarCropSettings): Promise<File> {
  const image = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the profile picture')
    const rect = avatarDrawRect(image.width, image.height, settings)
    if (settings.cropToCircle) {
      context.beginPath()
      context.arc(256, 256, 256, 0, Math.PI * 2)
      context.clip()
    }
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Could not prepare the profile picture')),
      'image/webp',
      0.9,
    ))
    return new File([blob], 'avatar.webp', { type: 'image/webp' })
  } finally {
    image.close()
  }
}
