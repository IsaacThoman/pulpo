import { useEffect, useState } from 'react'
import { getCachedAttachment } from '@/lib/local-first/attachment-cache'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { runtimeAccountKey } from '@/lib/runtime'
import { useRuntimeImageUrl } from '@/lib/runtime-resource'
import { loadAttachmentThumbnail } from '@/lib/attachment-thumbnails'

export function useAttachmentPreviewUrl(
  attachmentId: string | undefined,
  enabled = true,
  variant: 'thumbnail' | 'full' = 'full',
): {
  url: string | null
  loading: boolean
} {
  const userId = useAuth((s) => s.user?.id)
  const requestKey = enabled && attachmentId && userId
    ? `${runtimeAccountKey(userId)}:${attachmentId}:${variant}`
    : null
  const [resolved, setResolved] = useState<{
    key: string
    source: string | Blob | null
    loading: boolean
  } | null>(null)

  useEffect(() => {
    if (!requestKey || !attachmentId || !userId) return
    let cancelled = false
    const controller = new AbortController()
    setResolved({ key: requestKey, source: null, loading: true })

    void (async () => {
      try {
        if (variant === 'thumbnail') {
          const blob = await loadAttachmentThumbnail(runtimeAccountKey(userId), attachmentId, controller.signal)
          if (!cancelled) setResolved({ key: requestKey, source: blob, loading: false })
          return
        }
        const cached = await getCachedAttachment(userId, attachmentId)
        if (cancelled) return
        if (cached) {
          setResolved({ key: requestKey, source: cached.blob, loading: false })
          return
        }
        const { url: remote } = await apiRequest<{ url: string }>(`/api/attachments/${attachmentId}/download`)
        if (cancelled) return
        setResolved({ key: requestKey, source: remote, loading: false })
      } catch {
        if (!cancelled) setResolved({ key: requestKey, source: null, loading: false })
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [attachmentId, requestKey, userId, variant])

  const current = resolved?.key === requestKey ? resolved : null
  const image = useRuntimeImageUrl(current?.source, { authenticated: true })
  return {
    url: image.url,
    loading: Boolean(requestKey && (!current || current.loading || image.loading)),
  }
}
