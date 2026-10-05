import { useEffect, useState } from 'react'
import type { FileNode } from '@pulpo/contracts'
import { Loader2 } from 'lucide-react'
import { Markdown } from '@/components/chat/Markdown'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { fetchFileBlob, fileUrl, isApiUrl } from './api'
import { filePreviewKind, filesErrorMessage, MAX_INLINE_PREVIEW_BYTES } from './file-display'

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'unsupported' }
  | { status: 'url'; url: string }
  | { status: 'text'; text: string }

/**
 * Inline preview of an uploaded file: images, PDFs, media, and text. Used by the side panel and
 * the full-page file view.
 */
export function FilePreviewBody({ node }: { node: FileNode }) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const kind = filePreviewKind(node)

  useEffect(() => {
    if (!kind) {
      setState({ status: 'unsupported' })
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setState({ status: 'loading' })
    void (async () => {
      try {
        if (kind === 'markdown' || kind === 'text') {
          const text = await (await fetchFileBlob(node)).text()
          if (!cancelled) setState({ status: 'text', text })
          return
        }
        // Presigned object-store URLs can stream media directly; API-served files need the session.
        const url = await fileUrl(node)
        if (!isApiUrl(url) && (kind === 'video' || kind === 'audio')) {
          if (!cancelled) setState({ status: 'url', url })
          return
        }
        if (node.sizeBytes > MAX_INLINE_PREVIEW_BYTES) {
          if (!cancelled) setState({ status: 'unsupported' })
          return
        }
        const blob = await fetchFileBlob(node)
        // Blob URLs share this page's origin, so the frame only ever receives a PDF type, never HTML.
        const type = kind === 'pdf' ? 'application/pdf' : node.mimeType ?? blob.type
        objectUrl = URL.createObjectURL(blob.slice(0, blob.size, type))
        if (!cancelled) setState({ status: 'url', url: objectUrl })
      } catch (cause) {
        if (!cancelled) setState({ status: 'error', message: filesErrorMessage(cause) })
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [node, kind])

  // Media uses the height left below the view's header.
  const media = 'max-h-[calc(100dvh-10rem)]'
  return (
    <>
      {state.status === 'loading' && <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      {state.status === 'error' && <p className="p-8 text-center text-sm text-destructive">{state.message}</p>}
      {state.status === 'unsupported' && <p className="p-8 text-center text-sm text-muted-foreground">{ui("No preview is available for this file. Download it to open it.")}</p>}
      {state.status === 'url' && kind === 'image' && <img src={state.url} alt={node.name} className={cn('mx-auto object-contain', media)} />}
      {state.status === 'url' && kind === 'pdf' && <iframe src={state.url} title={node.name} className="h-[calc(100dvh-10rem)] w-full" />}
      {state.status === 'url' && kind === 'video' && <video src={state.url} controls className={cn('mx-auto', media)} />}
      {state.status === 'url' && kind === 'audio' && <audio src={state.url} controls className="m-6 w-[calc(100%-3rem)]" />}
      {state.status === 'text' && !state.text.trim() && <p className="p-8 text-center text-sm text-muted-foreground">{ui("This file is empty.")}</p>}
      {state.status === 'text' && state.text.trim() && kind === 'markdown' && <div className="px-6 py-4"><Markdown content={state.text} /></div>}
      {state.status === 'text' && state.text.trim() && kind === 'text' && <pre className="overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{state.text}</pre>}
    </>
  )
}
