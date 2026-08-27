import { useEffect, useState } from 'react'
import { fetchApiBlob } from './api'
import { isDesktopRuntime, runtimeResourceUrl } from './runtime'
import { adminChatAccessActive } from '@/features/admin-chat/access'

export interface RuntimeImageResource {
  load(): Promise<string | null>
  dispose(): void
}

export function createRuntimeImageResource(
  source: string | Blob,
  authenticated: boolean,
): RuntimeImageResource {
  const controller = new AbortController()
  let disposed = false
  let objectUrl: string | null = null

  return {
    async load() {
      if (typeof source === 'string' && (!authenticated || (!isDesktopRuntime() && !adminChatAccessActive()))) {
        return runtimeResourceUrl(source)
      }
      let blob: Blob
      try {
        blob = typeof source === 'string'
          ? await fetchApiBlob(source, { signal: controller.signal })
          : source
      } catch (cause) {
        if (controller.signal.aborted) return null
        throw cause
      }
      if (disposed) return null
      objectUrl = URL.createObjectURL(blob)
      return objectUrl
    },
    dispose() {
      disposed = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = null
    },
  }
}

export function useRuntimeImageUrl(
  source: string | Blob | null | undefined,
  options: { authenticated: boolean },
): { url: string | null; loading: boolean } {
  const directUrl = typeof source === 'string' && (!options.authenticated || (!isDesktopRuntime() && !adminChatAccessActive()))
    ? runtimeResourceUrl(source)
    : null
  const needsLoading = Boolean(source && !directUrl)
  const [result, setResult] = useState<{ source: string | Blob; url: string | null } | null>(null)

  useEffect(() => {
    if (!source || directUrl) {
      setResult(null)
      return
    }
    const resource = createRuntimeImageResource(source, options.authenticated)
    void resource.load().then((url) => {
      if (url) setResult({ source, url })
    }).catch(() => setResult({ source, url: null }))
    return () => resource.dispose()
  }, [directUrl, options.authenticated, source])

  const resolvedUrl = result && result.source === source ? result.url : null
  return {
    url: directUrl ?? resolvedUrl,
    loading: needsLoading && result?.source !== source,
  }
}
