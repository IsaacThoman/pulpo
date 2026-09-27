import { useState } from 'react'
import { runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'

// Retain only geometry across virtual row remounts, not decoded images or object URLs.
type Dimensions = { width: number; height: number }
const sizes = new Map<string, Dimensions>()
const MAX_SIZES = 1000

export function useAttachmentImageDimensions(attachmentId: string) {
  const userId = useAuth(state => state.user?.id)
  const key = `${runtimeAccountKey(userId ?? '')}:${attachmentId}`
  const [measured, setMeasured] = useState<{ key: string; size: Dimensions } | null>(null)
  const dimensions = measured?.key === key ? measured.size : sizes.get(key)

  const rememberDimensions = (image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return
    const size = { width: image.naturalWidth, height: image.naturalHeight }
    sizes.delete(key)
    sizes.set(key, size)
    if (sizes.size > MAX_SIZES) sizes.delete(sizes.keys().next().value!)
    setMeasured(previous => previous?.key === key && previous.size.width === size.width && previous.size.height === size.height ? previous : { key, size })
  }

  return { dimensions, rememberDimensions }
}
