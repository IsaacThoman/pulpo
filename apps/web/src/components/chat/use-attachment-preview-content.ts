import { useEffect, useState } from 'react'
import type { Attachment } from '@/lib/types'
import { apiRequest, fetchApiBlob } from '@/lib/api'
import { getCachedAttachment } from '@/lib/local-first/attachment-cache'
import { useAuth } from '@/stores/auth'
import { formatBytes } from '@/lib/attachments'
import {
  formatTextPreview,
  isTextPreviewKind,
  previewSizeLimit,
  type AttachmentPreviewKind,
} from '@/lib/attachment-previews'
import { ui } from '@/i18n/ui'

export type PreviewContent =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string | null; text: string | null; textTruncated: boolean }
  | { status: 'error'; message: string }

function previewLabel(kind: AttachmentPreviewKind): string {
  if (kind === 'pdf') return ui("PDF preview")
  if (kind === 'table') return ui("Table preview")
  if (kind === 'markdown') return ui("Markdown preview")
  if (kind === 'text') return ui("Text preview")
  if (kind === 'sandbox') return ui("Live preview")
  return `${kind[0]!.toUpperCase()}${kind.slice(1)} preview`
}

export function attachmentDescription(attachment: Attachment, kind: AttachmentPreviewKind): string {
  return [previewLabel(kind), attachment.size > 0 ? formatBytes(attachment.size) : null]
    .filter(Boolean)
    .join(' · ')
}

export function usePreviewContent(
  attachment: Attachment,
  kind: AttachmentPreviewKind | null,
  open: boolean,
  sourceFile?: File,
): PreviewContent {
  const userId = useAuth((state) => state.user?.id)
  const [content, setContent] = useState<PreviewContent>({ status: 'idle' })

  useEffect(() => {
    if (!open || !kind) {
      setContent({ status: 'idle' })
      return
    }
    if (attachment.size > previewSizeLimit(kind)) {
      setContent({
        status: 'error',
        message: `This file is too large to preview (${formatBytes(attachment.size)}).`,
      })
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    setContent({ status: 'loading' })

    void (async () => {
      try {
        let blob: Blob | undefined = sourceFile
        if (!blob) {
          if (!userId) throw new Error(ui("Sign in to preview this file."))
          const cached = await getCachedAttachment(userId, attachment.id)
          if (cancelled) return
          if (cached) {
            blob = cached.blob
          } else {
            const { url } = await apiRequest<{ url: string }>(`/api/attachments/${attachment.id}/download`)
            blob = await fetchApiBlob(url)
          }
        }
        if (cancelled) return
        if (!blob) throw new Error(ui("This preview could not be loaded."))
        if (blob.size > previewSizeLimit(kind)) {
          throw new Error(`This file is too large to preview (${formatBytes(blob.size)}).`)
        }

        if (kind === 'table') {
          // Tables keep the whole file: rows are parsed and rendered on demand as the reader scrolls.
          const text = await blob.text()
          if (!cancelled) setContent({ status: 'ready', url: null, text, textTruncated: false })
          return
        }
        if (isTextPreviewKind(kind)) {
          const result = formatTextPreview(attachment.name, attachment.mimeType, await blob.text())
          if (!cancelled) setContent({ status: 'ready', url: null, text: result.text, textTruncated: result.truncated })
          return
        }

        const typedBlob = blob.type || !attachment.mimeType
          ? blob
          : new Blob([blob], { type: attachment.mimeType })
        objectUrl = URL.createObjectURL(typedBlob)
        setContent({ status: 'ready', url: objectUrl, text: null, textTruncated: false })
      } catch (cause) {
        if (!cancelled) setContent({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'This preview could not be loaded.',
        })
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, attachment.mimeType, attachment.name, attachment.size, kind, open, sourceFile, userId])

  return content
}
