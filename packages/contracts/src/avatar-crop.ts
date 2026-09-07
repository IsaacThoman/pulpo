import { z } from 'zod'

export const avatarCropSettingsSchema = z.object({
  cropToCircle: z.boolean(),
  zoom: z.number().min(1).max(3),
  offsetX: z.number(),
  offsetY: z.number(),
})

export type AvatarCropSettings = z.infer<typeof avatarCropSettingsSchema>

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

