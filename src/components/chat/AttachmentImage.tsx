import { useEffect, useState } from 'react'
import { Download, ImageIcon, Loader2, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
              className="group/attachment relative flex max-w-64 items-center gap-1.5 rounded-md border bg-background/50 py-1 pr-2 pl-9 text-xs leading-5"
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
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleDownload = () => {
    if (userId) void downloadAttachment(userId, attachment.id, attachment.name)
  }

  return (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <div
        title={attachment.name}
        className="group/attachment relative overflow-hidden rounded-xl border bg-background/40 shadow-sm"
      >
        <AttachmentDownloadButton name={attachment.name} onDownload={handleDownload} />
        {url ? (
          <button
            type="button"
            aria-label={`Preview ${attachment.name}`}
            onClick={() => setPreviewOpen(true)}
            className="block cursor-zoom-in"
          >
            <img
              src={url}
              alt={attachment.name}
              className="max-h-64 max-w-[min(100%,18rem)] object-contain"
              draggable={false}
            />
          </button>
        ) : (
          <div className="flex h-32 w-40 items-center justify-center bg-muted/50 text-muted-foreground">
            {loading ? <Loader2 className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}
          </div>
        )}
      </div>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] max-w-none items-center justify-center border-0 bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">Preview of {attachment.name}</DialogTitle>
        <div className="flex max-h-full max-w-full flex-col items-end gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`Download ${attachment.name}`}
              onClick={handleDownload}
              className="rounded-full border-white/20 bg-black/40 text-white shadow-sm hover:bg-black/60 hover:text-white"
            >
              <Download className="size-4" />
            </Button>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Close preview"
                className="rounded-full border-white/20 bg-black/40 text-white shadow-sm hover:bg-black/60 hover:text-white"
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          {url && (
            <img
              src={url}
              alt={attachment.name}
              className="min-h-0 max-h-[calc(100dvh-7rem)] max-w-full object-contain"
              draggable={false}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
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
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={`Download ${name}`}
      onClick={onDownload}
      className={cn(
        'absolute top-1 left-1 z-10 size-7 rounded-full bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/attachment:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      <Download className="size-3.5" />
    </Button>
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
        'group group/attachment relative size-20 overflow-hidden rounded-xl border bg-muted/30 shadow-sm',
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
