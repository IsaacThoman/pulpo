import { useState } from 'react'
import type { ToolImagePreview as Preview } from '@pulpo/contracts'
import { Loader2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { useAttachmentPreviewUrl } from './use-attachment-preview-url'

export function ToolImagePreview({ preview, expanded }: { preview?: Preview; expanded: boolean }) {
  return expanded && preview ? <Thumbnail key={preview.attachmentId} preview={preview} /> : null
}

function Thumbnail({ preview }: { preview: Preview }) {
  const { url, loading } = useAttachmentPreviewUrl(preview.attachmentId, true, 'thumbnail')
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  if (failed || (!loading && !url)) {
    return <p className="text-xs text-muted-foreground" role="status">{ui('Image preview unavailable')}</p>
  }
  return (
    <div className="relative w-fit max-w-full overflow-hidden rounded-md bg-muted/25">
      {(loading || (url && loadedUrl !== url)) && <div className="flex h-24 w-48 max-w-full items-center justify-center" role="status" aria-label={ui('Loading image preview')}><Loader2 className="size-4 animate-spin" /></div>}
      {url && <img src={url} alt={preview.name} draggable={false} onLoad={() => setLoadedUrl(url)} onError={() => setFailed(true)} className={`max-h-48 max-w-full object-contain ${loadedUrl === url ? 'block' : 'hidden'}`} />}
    </div>
  )
}
