import { avatarDrawRect, type AvatarCropSettings } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

export { avatarDrawRect, DEFAULT_AVATAR_CROP, type AvatarCropSettings } from '@pulpo/contracts'

export function isGifAvatar(file: File): boolean {
  return file.type.toLowerCase() === 'image/gif' || (!file.type && /\.gif$/i.test(file.name))
}

export async function prepareAvatarUpload(file: File, settings: AvatarCropSettings): Promise<FormData> {
  const body = new FormData()
  if (isGifAvatar(file)) {
    body.append('crop', JSON.stringify(settings))
    body.append('file', new File([file], file.name, { type: 'image/gif' }))
  } else {
    body.append('file', await prepareAvatarFile(file, settings))
  }
  return body
}

export async function prepareAvatarFile(file: File, settings: AvatarCropSettings): Promise<File> {
  const image = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) throw new Error(ui("Could not prepare the profile picture"))
    const rect = avatarDrawRect(image.width, image.height, settings)
    if (settings.cropToCircle) {
      context.beginPath()
      context.arc(256, 256, 256, 0, Math.PI * 2)
      context.clip()
    }
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error(ui("Could not prepare the profile picture"))),
      'image/webp',
      0.9,
    ))
    return new File([blob], blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.png', { type: blob.type })
  } finally {
    image.close()
  }
}
