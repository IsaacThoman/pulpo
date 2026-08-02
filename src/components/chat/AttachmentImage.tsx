import { useEffect, useState } from 'react'
import { Download, ImageIcon, Loader2, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { downloadAttachment, getCachedAttachment } from '@/lib/local-first/attachment-cache'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { formatBytes } from '@/lib/attachments'

function useAttachmentPreviewUrl(attachmentId: string | undefined, enabled = true): {
  url: string | null
  loading: boolean
} {
  const userId = useAuth((s) => s.user?.id)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !attachmentId || !userId) {
      setUrl(null)
      setLoading(false)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setUrl(null)

    void (async () => {
      try {
        const cached = await getCachedAttachment(userId, attachmentId)
        if (cancelled) return
        if (cached) {
          objectUrl = URL.createObjectURL(cached.blob)
          setUrl(objectUrl)
          return
        }
        const { url: remote } = await apiRequest<{ url: string }>(`/api/attachments/${attachmentId}/download`)
        if (cancelled) return
        setUrl(remote)
      } catch {
        if (!cancelled) setUrl(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId, enabled, userId])

  return { url, loading }
}

export function MessageAttachmentList({
  attachments,
  align = 'end',
}: {
  attachments: Attachment[]
  align?: 'start' | 'end'
}) {
  if (!attachments.length) return null
  const images = attachments.filter((a) => a.type === 'image')
  const files = attachments.filter((a) => a.type !== 'image')

  return (
    <div className={cn('flex flex-col gap-2', align === 'end' ? 'items-end' : 'items-start')}>
      {images.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', align === 'end' && 'justify-end')}>
          {images.map((attachment) => (
            <MessageImagePreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className={cn('flex flex-wrap gap-1.5', align === 'end' && 'justify-end')}>
          {files.map((attachment) => (
            <div
              key={attachment.id}
              className="relative flex max-w-64 items-center gap-1.5 rounded-md border bg-background/50 py-1 pr-2 pl-9 text-xs leading-5"
            >
              <AttachmentDownloadButton
                name={attachment.name}
                className="top-0.5 left-1 size-6"
                onDownload={() => {
                  const userId = useAuth.getState().user?.id
                  if (userId) void downloadAttachment(userId, attachment.id, attachment.name)
                }}
              />
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{attachment.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageImagePreview({ attachment }: { attachment: Attachment }) {
  const { url, loading } = useAttachmentPreviewUrl(attachment.id)
  const userId = useAuth((s) => s.user?.id)

  return (
    <div
      title={attachment.name}
      className="group/img relative overflow-hidden rounded-xl border bg-background/40 shadow-sm"
    >
      <AttachmentDownloadButton
        name={attachment.name}
        onDownload={() => {
          if (userId) void downloadAttachment(userId, attachment.id, attachment.name)
        }}
      />
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          className="max-h-64 max-w-[min(100%,18rem)] object-contain"
          draggable={false}
        />
      ) : (
        <div className="flex h-32 w-40 items-center justify-center bg-muted/50 text-muted-foreground">
          {loading ? <Loader2 className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}
        </div>
      )}
    </div>
  )
}

function AttachmentDownloadButton({
  name,
  onDownload,
  className,
}: {
  name: string
  onDownload: () => void
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Download ${name}`}
          onClick={onDownload}
          className={cn(
            'absolute top-1 left-1 z-10 size-7 rounded-full bg-background/90 shadow-sm backdrop-blur-sm',
            className,
          )}
        >
          <Download className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Download</TooltipContent>
    </Tooltip>
  )
}

export function PendingImageChip({
  name,
  size,
  previewUrl,
  uploading,
  error,
  onDownload,
  onRemove,
}: {
  name: string
  size: number
  previewUrl?: string | null
  uploading?: boolean
  error?: string | null
  onDownload: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        'group relative size-20 overflow-hidden rounded-xl border bg-muted/30 shadow-sm',
        error && 'border-destructive/50',
      )}
    >
      {previewUrl ? (
        <img src={previewUrl} alt={name} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
          <ImageIcon className="size-5" />
          <span className="w-full truncate px-1 text-center text-[10px]">{name}</span>
        </div>
      )}
      {(uploading || error) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
          {uploading ? (
            <Loader2 className="size-5 animate-spin text-foreground" />
          ) : (
            <span className="px-1 text-center text-[10px] font-medium text-destructive">Failed</span>
          )}
        </div>
      )}
      <AttachmentDownloadButton name={name} onDownload={onDownload} />
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3" />
      </button>
      {!uploading && !error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1.5 pt-4 pb-1 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-[10px] font-medium text-white">{name}</p>
          {size > 0 && <p className="text-[9px] text-white/80">{formatBytes(size)}</p>}
        </div>
      )}
    </div>
  )
}
