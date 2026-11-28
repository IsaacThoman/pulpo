import { contrastRatio, flattenHex } from '../../web/src/lib/color'

const sampleSize = 16
const lightBackdrop = '#fafafa'
const darkBackdrop = '#18181b'

export function sampleFavicon(image: HTMLImageElement) {
  const { naturalWidth, naturalHeight } = image
  if (!naturalWidth || !naturalHeight) return
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = sampleSize
    const context = canvas.getContext('2d')
    if (!context) return
    const scale = sampleSize / Math.max(naturalWidth, naturalHeight)
    const width = naturalWidth * scale
    const height = naturalHeight * scale
    context.drawImage(image, (sampleSize - width) / 2, (sampleSize - height) / 2, width, height)
    return context.getImageData(0, 0, sampleSize, sampleSize).data
  } catch {
    // Canvas readback can be blocked by browser privacy settings.
    return undefined
  }
}

export function faviconBackdrop(pixels: Uint8ClampedArray, page: string) {
  const backdrops = [page, lightBackdrop, darkBackdrop]
  const readable = [0, 0, 0]
  let visible = 0
  let opaque = 0

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    if (alpha === 0) continue
    if (alpha >= 200) opaque += 1
    const color = '#' + pixels.slice(index, index + 4).reduce((hex, channel) => hex + channel.toString(16).padStart(2, '0'), '')
    visible += alpha
    backdrops.forEach((background, candidate) => {
      if (contrastRatio(flattenHex(color, background), background) >= 3) readable[candidate] += alpha
    })
  }

  // A filled tile, as favicon services often return, already carries its own background.
  if (opaque >= (pixels.length / 4) * 0.85) return
  // Judge the mark by most of its visible area, weighting antialiased edges by opacity.
  if (readable[0] >= visible / 2) return
  const best = readable[1] >= readable[2] ? 1 : 2
  return readable[best] >= visible / 2 ? backdrops[best] : undefined
}
