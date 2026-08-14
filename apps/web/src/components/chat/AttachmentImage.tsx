import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  ImageIcon,
  Loader2,
  Presentation,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { downloadAttachment, getCachedAttachment } from '@/lib/local-first/attachment-cache'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import {
  attachmentKind,
  attachmentTypeLabel,
  formatBytes,
  type AttachmentKind,
} from '@/lib/attachments'

const ATTACHMENT_KIND_DETAILS: Record<AttachmentKind, {
  icon: LucideIcon
  color: string
}> = {
  image: { icon: FileImage, color: 'bg-sky-500/12 text-sky-700 ring-sky-500/15 dark:text-sky-300' },
  pdf: { icon: FileText, color: 'bg-rose-500/12 text-rose-700 ring-rose-500/15 dark:text-rose-300' },
  text: { icon: FileText, color: 'bg-blue-500/12 text-blue-700 ring-blue-500/15 dark:text-blue-300' },
  code: { icon: FileCode2, color: 'bg-violet-500/12 text-violet-700 ring-violet-500/15 dark:text-violet-300' },
  spreadsheet: { icon: FileSpreadsheet, color: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/15 dark:text-emerald-300' },
  presentation: { icon: Presentation, color: 'bg-orange-500/12 text-orange-700 ring-orange-500/15 dark:text-orange-300' },
  archive: { icon: FileArchive, color: 'bg-amber-500/12 text-amber-700 ring-amber-500/15 dark:text-amber-300' },
  audio: { icon: FileAudio, color: 'bg-fuchsia-500/12 text-fuchsia-700 ring-fuchsia-500/15 dark:text-fuchsia-300' },
  video: { icon: FileVideo, color: 'bg-cyan-500/12 text-cyan-700 ring-cyan-500/15 dark:text-cyan-300' },
  file: { icon: File, color: 'bg-slate-500/12 text-slate-700 ring-slate-500/15 dark:text-slate-300' },
}

function useAttachmentPreviewUrl(
  attachmentId: string | undefined,
  enabled = true,
  variant: 'thumbnail' | 'full' = 'full',
): {
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
        if (variant === 'thumbnail') {
          setUrl(`/api/attachments/${attachmentId}/thumbnail`)
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
  }, [attachmentId, enabled, userId, variant])

  return { url, loading }
}

function attachmentMeta(name: string, mimeType: string, size: number): string {
  return [attachmentTypeLabel(name, mimeType), size > 0 ? formatBytes(size) : null]
    .filter(Boolean)
    .join(' · ')
}

function AttachmentTypeIcon({ name, mimeType, className }: {
  name: string
  mimeType: string
  className?: string
}) {
  const kind = attachmentKind(name, mimeType)
  const details = ATTACHMENT_KIND_DETAILS[kind]
  const Icon = details.icon

  return (
    <span className={cn(
      'flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
      details.color,
      className,
    )}>
      <Icon className="size-5" aria-hidden="true" />
    </span>
  )
}

function performAttachmentDownload(attachment: Attachment): void {
  const userId = useAuth.getState().user?.id
  if (!userId) return
  void downloadAttachment(userId, {
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size,
  }, useSettings.getState().localAttachmentCacheMb)
}

export function MessageAttachmentList({
  attachments,
  align = 'end',
}: {
  attachments: Attachment[]
  align?: 'start' | 'end'
}) {
  if (!attachments.length) return null
  const images = attachments.filter((attachment) => attachmentKind(attachment.name, attachment.mimeType) === 'image')
  const files = attachments.filter((attachment) => attachmentKind(attachment.name, attachment.mimeType) !== 'image')

  return (
    <div className={cn('flex w-full flex-col gap-2', align === 'end' ? 'items-end' : 'items-start')}>
      {images.length > 0 && (
        <div className={cn('flex max-w-full flex-wrap gap-2', align === 'end' && 'justify-end')}>
          {images.map((attachment) => (
            <MessageImagePreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="grid w-full max-w-[19rem] gap-2">
          {files.map((attachment) => (
            <div
              key={attachment.id}
              title={attachment.name}
              className="group/attachment flex min-w-0 items-center gap-3 rounded-2xl border bg-background/75 p-2.5 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-foreground/15 hover:bg-background hover:shadow-md"
            >
              <AttachmentTypeIcon name={attachment.name} mimeType={attachment.mimeType} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-5">{attachment.name}</span>
                <span className="mt-0.5 block text-[11px] font-medium tracking-wide text-muted-foreground">
                  {attachmentMeta(attachment.name, attachment.mimeType, attachment.size)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => performAttachmentDownload(attachment)}
                aria-label={`Download ${attachment.name}`}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageImagePreview({ attachment }: { attachment: Attachment }) {
  const { url, loading } = useAttachmentPreviewUrl(attachment.id, true, 'thumbnail')
  const [previewOpen, setPreviewOpen] = useState(false)
  const { url: fullUrl } = useAttachmentPreviewUrl(attachment.id, previewOpen, 'full')
  const handleDownload = () => performAttachmentDownload(attachment)

  return (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <figure
        title={attachment.name}
        className="group/attachment relative w-[min(19rem,100%)] max-w-full overflow-hidden rounded-2xl border bg-background/75 shadow-sm"
      >
        <button
          type="button"
          aria-label={`Preview ${attachment.name}`}
          onClick={() => setPreviewOpen(true)}
          className="block w-full cursor-zoom-in bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {url ? (
            <img
              src={url}
              alt={attachment.name}
              className="mx-auto block max-h-72 min-h-28 w-full object-contain transition-transform duration-300 group-hover/attachment:scale-[1.01]"
              draggable={false}
            />
          ) : (
            <span className="flex h-36 w-full items-center justify-center text-muted-foreground">
              {loading ? <Loader2 className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}
            </span>
          )}
        </button>
        <figcaption className="flex min-w-0 items-center gap-2 border-t bg-background/90 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{attachment.name}</span>
            <span className="block text-[10px] font-medium tracking-wide text-muted-foreground">
              {attachmentMeta(attachment.name, attachment.mimeType, attachment.size)}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Download ${attachment.name}`}
            onClick={handleDownload}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-4" />
          </button>
        </figcaption>
      </figure>
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
          {(fullUrl ?? url) && (
            <img
              src={fullUrl ?? url ?? undefined}
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

export function PendingAttachmentChip({
  name,
  size,
  mimeType,
  previewUrl,
  attachmentId,
  uploading,
  error,
  onDownload,
  onRemove,
}: {
  name: string
  size: number
  mimeType: string
  previewUrl?: string | null
  attachmentId?: string
  uploading?: boolean
  error?: string | null
  onDownload: () => void
  onRemove: () => void
}) {
  const kind = attachmentKind(name, mimeType)
  const remotePreview = useAttachmentPreviewUrl(attachmentId, kind === 'image' && !previewUrl, 'thumbnail')
  const resolvedPreviewUrl = previewUrl ?? remotePreview.url

  if (kind !== 'image') {
    return (
      <div className={cn(
        'group/attachment relative w-64 max-w-full overflow-hidden rounded-2xl border bg-muted/20 shadow-sm transition-colors hover:bg-muted/35',
        error && 'border-destructive/40 bg-destructive/5',
      )} title={error ?? name}>
        <div className="flex w-full min-w-0 items-center gap-3 p-2.5 pr-[4.75rem] text-left">
          <AttachmentTypeIcon name={name} mimeType={mimeType} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-5">{name}</span>
            <span className={cn(
              'mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground',
              error && 'text-destructive',
            )}>
              {uploading && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
              {error && <AlertCircle className="size-3" aria-hidden="true" />}
              {error ? 'Upload failed' : uploading ? 'Uploading' : attachmentMeta(name, mimeType, size)}
            </span>
          </span>
        </div>
        <button
          type="button"
          aria-label={`Download ${name}`}
          onClick={onDownload}
          className="absolute top-2 right-10 flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group/attachment relative size-24 overflow-hidden rounded-2xl border bg-muted/30 shadow-sm',
        error && 'border-destructive/50',
      )}
      title={error ?? name}
    >
      <div className="size-full">
        {resolvedPreviewUrl ? (
          <img src={resolvedPreviewUrl} alt={name} className="size-full object-cover" draggable={false} />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
            <ImageIcon className="size-5" />
            <span className="w-full truncate px-1 text-center text-[10px]">{name}</span>
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-left">
          <span className="block truncate text-[10px] font-medium text-white">{name}</span>
          <span className="block text-[9px] text-white/80">
            {error ? 'Upload failed' : uploading ? 'Uploading' : attachmentMeta(name, mimeType, size)}
          </span>
        </span>
      </div>
      {uploading && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/45 backdrop-blur-[1px]">
          <Loader2 className="size-5 animate-spin text-foreground" />
        </span>
      )}
      {error && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-destructive/10">
          <AlertCircle className="size-5 text-destructive" />
        </span>
      )}
      <button
        type="button"
        aria-label={`Download ${name}`}
        onClick={onDownload}
        className="absolute top-1.5 left-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Download className="size-3" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
