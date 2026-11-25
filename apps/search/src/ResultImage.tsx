import { useState, type ReactNode } from 'react'
import { safeHttpUrl } from './navigation'

export function ResultImage({ sources, alt, fallback, lazy }: {
  sources: readonly (string | undefined)[]
  alt: string
  fallback: ReactNode
  lazy?: boolean
}) {
  const [failed, setFailed] = useState<string[]>([])
  const src = sources.map(safeHttpUrl).find(url => url && !failed.includes(url.href))
  if (!src) return fallback
  return <img src={src.href} alt={alt} loading={lazy ? 'lazy' : undefined} decoding="async" referrerPolicy="no-referrer"
    onError={() => setFailed(previous => [...previous, src.href])} />
}
