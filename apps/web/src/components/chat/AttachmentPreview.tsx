import { useEffect, useMemo, useState } from 'react'
import { Download, FileWarning, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Attachment } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { getCachedAttachment } from '@/lib/local-first/attachment-cache'
import { useAuth } from '@/stores/auth'
import { formatBytes } from '@/lib/attachments'
import {
  attachmentPreviewKind,
  formatTextPreview,
  parseDelimitedPreview,
  previewSizeLimit,
  type AttachmentPreviewKind,
  type DelimitedPreview,
} from '@/lib/attachment-previews'

type PreviewContent =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string | null; text: string | null; textTruncated: boolean }
  | { status: 'error'; message: string }

function previewLabel(kind: AttachmentPreviewKind): string {
  if (kind === 'pdf') return 'PDF preview'
  if (kind === 'table') return 'Table preview'
  if (kind === 'text') return 'Text preview'
  return `${kind[0]!.toUpperCase()}${kind.slice(1)} preview`
}

function attachmentDescription(attachment: Attachment, kind: AttachmentPreviewKind): string {
  return [previewLabel(kind), attachment.size > 0 ? formatBytes(attachment.size) : null]
    .filter(Boolean)
    .join(' · ')
}

function usePreviewContent(
  attachment: Attachment,
  kind: AttachmentPreviewKind | null,
  open: boolean,
  sourceFile?: File,
  contentUrl?: string,
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
          if (contentUrl) {
            const response = await fetch(contentUrl, { credentials: 'include' })
            if (!response.ok) throw new Error(`Preview failed (${response.status})`)
            blob = await response.blob()
          } else {
            if (!userId) throw new Error('Sign in to preview this file.')
            const cached = await getCachedAttachment(userId, attachment.id)
            if (cancelled) return
            if (cached) {
              blob = cached.blob
            } else {
              const { url } = await apiRequest<{ url: string }>(`/api/attachments/${attachment.id}/download`)
              const response = await fetch(url, { credentials: url.startsWith('/api/') ? 'include' : 'omit' })
              if (!response.ok) throw new Error(`Preview failed (${response.status})`)
              blob = await response.blob()
            }
          }
        }
        if (cancelled) return
        if (!blob) throw new Error('This preview could not be loaded.')
        if (blob.size > previewSizeLimit(kind)) {
          throw new Error(`This file is too large to preview (${formatBytes(blob.size)}).`)
        }

        if (kind === 'text' || kind === 'table') {
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
  }, [attachment.id, attachment.mimeType, attachment.name, attachment.size, contentUrl, kind, open, sourceFile, userId])

  return content
}

function TextPreview({
  attachment,
  text,
  truncated,
  table,
}: {
  attachment: Attachment
  text: string
  truncated: boolean
  table: DelimitedPreview | null
}) {
  if (table) {
    return (
      <div className="size-full overflow-auto bg-background" data-preview-kind="table">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr>
              {table.headers.map((header, column) => (
                <th key={`${header}:${column}`} className="max-w-72 border-r border-b px-3 py-2 font-semibold last:border-r-0">
                  <span className="block truncate">{header}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-muted/20 hover:bg-muted/35">
                {table.headers.map((_, column) => (
                  <td key={column} className="max-w-72 border-r border-b px-3 py-2 align-top last:border-r-0">
                    <span className="block max-w-72 whitespace-pre-wrap break-words">{row[column] ?? ''}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(truncated || table.truncated) && (
          <p className="sticky bottom-0 border-t bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            Showing the first part of {attachment.name}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="size-full overflow-auto bg-[#0d1117] text-slate-200" data-preview-kind="text">
      <pre className="min-h-full p-5 font-mono text-xs leading-5 whitespace-pre-wrap break-words">{text}</pre>
      {truncated && (
        <p className="sticky bottom-0 border-t border-white/10 bg-[#0d1117]/95 px-5 py-2 text-xs text-slate-400 backdrop-blur">
          Showing the first part of {attachment.name}.
        </p>
      )}
    </div>
  )
}

function PreviewBody({
  attachment,
  kind,
  content,
}: {
  attachment: Attachment
  kind: AttachmentPreviewKind
  content: PreviewContent
}) {
  const table = useMemo(() => content.status === 'ready' && kind === 'table' && content.text
    ? parseDelimitedPreview(attachment.name, attachment.mimeType, content.text)
    : null, [attachment.mimeType, attachment.name, content, kind])

  if (content.status === 'idle' || content.status === 'loading') {
    return (
      <div role="status" className="flex size-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        Loading preview…
      </div>
    )
  }
  if (content.status === 'error') {
    return (
      <div role="alert" className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <FileWarning className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium">Preview unavailable</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{content.message}</p>
        </div>
      </div>
    )
  }
  if ((kind === 'text' || kind === 'table') && content.text !== null) {
    return <TextPreview attachment={attachment} text={content.text} truncated={content.textTruncated} table={table} />
  }
  if (!content.url) return null
  if (kind === 'image') {
    return <img src={content.url} alt={attachment.name} className="size-full object-contain p-4" data-preview-kind="image" draggable={false} />
  }
  if (kind === 'pdf') {
    return <iframe src={content.url} title={`Preview of ${attachment.name}`} className="size-full bg-white" data-preview-kind="pdf" />
  }
  if (kind === 'audio') {
    return (
      <div className="flex size-full items-center justify-center bg-gradient-to-br from-fuchsia-500/10 via-background to-violet-500/10 p-6" data-preview-kind="audio">
        <audio src={content.url} controls preload="metadata" aria-label={`Audio preview of ${attachment.name}`} className="w-full max-w-xl" />
      </div>
    )
  }
  return <video src={content.url} controls preload="metadata" aria-label={`Video preview of ${attachment.name}`} className="size-full bg-black object-contain" data-preview-kind="video" />
}

export function AttachmentPreviewDialog({
  attachment,
  sourceFile,
  open,
  onOpenChange,
  onDownload,
  contentUrl,
}: {
  attachment: Attachment
  sourceFile?: File
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => void
  contentUrl?: string
}) {
  const kind = attachmentPreviewKind(attachment.name, attachment.mimeType)
  const content = usePreviewContent(attachment, kind, open, sourceFile, contentUrl)
  if (!kind) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="attachment-preview-dialog"
        className="flex h-[min(88dvh,52rem)] w-[min(calc(100vw-2rem),64rem)] max-w-none grid-rows-none flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-none"
      >
        <header className="flex min-w-0 shrink-0 items-center gap-3 border-b px-4 py-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <DialogTitle className="min-w-0 truncate text-sm">{attachment.name}</DialogTitle>
            <DialogDescription className="shrink-0 whitespace-nowrap text-xs">
              {attachmentDescription(attachment, kind)}
            </DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDownload} aria-label={`Download ${attachment.name}`} className="rounded-full">
            <Download className="size-4" />
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close preview" className="rounded-full">
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden bg-muted/25">
          <PreviewBody attachment={attachment} kind={kind} content={content} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
