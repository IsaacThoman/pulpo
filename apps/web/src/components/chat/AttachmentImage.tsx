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
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react'
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
  isSupportedImageMime,
  type AttachmentKind,
} from '@/lib/attachments'
import { attachmentPreviewKind } from '@/lib/attachment-previews'
import { runtimeAccountKey } from '@/lib/runtime'
import { useRuntimeImageUrl } from '@/lib/runtime-resource'
import { AttachmentPreviewDialog } from './AttachmentPreview'
import { useUploadOutbox, type UploadRecord } from '@/stores/upload-outbox'
import { ui, uit } from '@/i18n/ui'

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
    setResolved({ key: requestKey, source: null, loading: true })

    void (async () => {
      try {
        const cached = await getCachedAttachment(userId, attachmentId)
        if (cancelled) return
        if (cached) {
          setResolved({ key: requestKey, source: cached.blob, loading: false })
          return
        }
        if (variant === 'thumbnail') {
          setResolved({
            key: requestKey,
            source: `/api/attachments/${attachmentId}/thumbnail`,
            loading: false,
          })
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
    }
  }, [attachmentId, requestKey, userId, variant])

  const current = resolved?.key === requestKey ? resolved : null
  const image = useRuntimeImageUrl(current?.source, { authenticated: true })
  return {
    url: image.url,
    loading: Boolean(requestKey && (!current || current.loading || image.loading)),
  }
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
  const pending = attachments.filter((attachment) => attachment.localUploadId)
  const durable = attachments.filter((attachment) => !attachment.localUploadId)
  const images = durable.filter((attachment) => attachmentKind(attachment.name, attachment.mimeType) === 'image')
  const files = durable.filter((attachment) => attachmentKind(attachment.name, attachment.mimeType) !== 'image')

  return (
    <div className={cn('flex w-full flex-col gap-2', align === 'end' ? 'items-end' : 'items-start')}>
      {pending.length > 0 && (
        <div className={cn('flex max-w-full flex-wrap gap-2', align === 'end' && 'justify-end')}>
          {pending.map((attachment) => (
            <PendingMessageAttachment key={attachment.localUploadId} attachment={attachment} />
          ))}
        </div>
      )}
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
            <MessageFilePreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  )
}

function downloadPendingAttachment(record: UploadRecord): void {
  if (record.file) {
    const url = URL.createObjectURL(record.file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = record.file.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return
  }
  const userId = useAuth.getState().user?.id
  if (!userId || !record.id) return
  void downloadAttachment(userId, {
    id: record.id,
    originalName: record.name,
    mimeType: record.mimeType,
    sizeBytes: record.size,
  }, useSettings.getState().localAttachmentCacheMb)
}

function PendingMessageAttachment({ attachment }: { attachment: Attachment }) {
  const record = useUploadOutbox((state) => attachment.localUploadId
    ? state.uploads[attachment.localUploadId]
    : undefined)
  if (!record) return null
  return (
    <PendingAttachmentChip
      name={record.name}
      size={record.size}
      mimeType={record.mimeType}
      previewUrl={record.previewUrl}
      attachmentId={record.id}
      sourceFile={record.file}
      uploading={record.status === 'uploading'}
      error={record.status === 'error' ? record.error : null}
      onDownload={() => downloadPendingAttachment(record)}
    />
  )
}

function MessageFilePreview({ attachment }: { attachment: Attachment }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewable = attachmentPreviewKind(attachment.name, attachment.mimeType) !== null
  const details = (
    <>
      <AttachmentTypeIcon name={attachment.name} mimeType={attachment.mimeType} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-5">{attachment.name}</span>
        <span className="mt-0.5 block text-[11px] font-medium tracking-wide text-muted-foreground">
          {attachmentMeta(attachment.name, attachment.mimeType, attachment.size)}
        </span>
      </span>
    </>
  )

  return (
    <>
      <div
        title={previewable ? uit`Preview ${attachment.name}` : attachment.name}
        className="group/attachment flex min-w-0 items-center rounded-2xl border bg-background/75 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-foreground/15 hover:bg-background hover:shadow-md"
      >
        {previewable ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label={uit`Preview ${attachment.name}`}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-l-2xl p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {details}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 p-2.5">{details}</div>
        )}
        <button
          type="button"
          onClick={() => performAttachmentDownload(attachment)}
          aria-label={uit`Download ${attachment.name}`}
          className="mr-2.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-4" aria-hidden="true" />
        </button>
      </div>
      {previewable && (
        <AttachmentPreviewDialog
          attachment={attachment}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          onDownload={() => performAttachmentDownload(attachment)}
        />
      )}
    </>
  )
}

function MessageImagePreview({ attachment }: { attachment: Attachment }) {
  const { url, loading } = useAttachmentPreviewUrl(
    attachment.id,
    true,
    isSupportedImageMime(attachment.mimeType) ? 'thumbnail' : 'full',
  )
  const [previewOpen, setPreviewOpen] = useState(false)
  const handleDownload = () => performAttachmentDownload(attachment)

  return (
    <>
      <figure
        title={attachment.name}
        className="group/attachment relative w-[min(19rem,100%)] max-w-full overflow-hidden rounded-2xl border bg-background/75 shadow-sm"
      >
        <button
          type="button"
          aria-label={uit`Preview ${attachment.name}`}
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
            aria-label={uit`Download ${attachment.name}`}
            onClick={handleDownload}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-4" />
          </button>
        </figcaption>
      </figure>
      <AttachmentPreviewDialog
        attachment={attachment}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onDownload={handleDownload}
      />
    </>
  )
}

export function PendingAttachmentChip({
  name,
  size,
  mimeType,
  previewUrl,
  attachmentId,
  sourceFile,
  uploading,
  error,
  onDownload,
  onRetry,
  onRemove,
}: {
  name: string
  size: number
  mimeType: string
  previewUrl?: string | null
  attachmentId?: string
  sourceFile?: File
  uploading?: boolean
  error?: string | null
  onDownload: () => void
  onRetry?: () => void
  onRemove?: () => void
}) {
  const kind = attachmentKind(name, mimeType)
  const remotePreview = useAttachmentPreviewUrl(
    attachmentId,
    kind === 'image' && !previewUrl,
    isSupportedImageMime(mimeType) ? 'thumbnail' : 'full',
  )
  const resolvedPreviewUrl = previewUrl ?? remotePreview.url
  const [previewOpen, setPreviewOpen] = useState(false)
  const attachment: Attachment = {
    id: attachmentId ?? `local:${name}`,
    name,
    mimeType,
    type: kind === 'image' ? 'image' : 'file',
    size,
  }
  const previewable = Boolean(sourceFile || attachmentId) && attachmentPreviewKind(name, mimeType) !== null
  const previewDialog = previewable ? (
    <AttachmentPreviewDialog
      attachment={attachment}
      sourceFile={sourceFile}
      open={previewOpen}
      onOpenChange={setPreviewOpen}
      onDownload={onDownload}
    />
  ) : null

  if (kind !== 'image') {
    const details = (
      <>
        <AttachmentTypeIcon name={name} mimeType={mimeType} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-5">{name}</span>
          <span className={cn(
            'mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground',
            error && 'text-destructive',
          )}>
            {uploading && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
            {error && <AlertCircle className="size-3" aria-hidden="true" />}
            {error ? ui("Upload failed") : uploading ? ui("Uploading") : attachmentMeta(name, mimeType, size)}
          </span>
        </span>
      </>
    )
    return (
      <>
        <div className={cn(
          'group/attachment relative w-64 max-w-full overflow-hidden rounded-2xl border bg-muted/20 shadow-sm transition-colors hover:bg-muted/35',
          error && 'border-destructive/40 bg-destructive/5',
        )} title={error ?? (previewable ? uit`Preview ${name}` : name)}>
          {previewable ? (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              aria-label={uit`Preview ${name}`}
              className={cn(
                'flex h-full w-full min-w-0 cursor-pointer items-center gap-3 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                onRemove ? 'pr-[4.75rem]' : 'pr-12',
              )}
            >
              {details}
            </button>
          ) : (
            <div className={cn('flex h-full w-full min-w-0 items-center gap-3 p-2.5 text-left', onRemove ? 'pr-[4.75rem]' : 'pr-12')}>{details}</div>
          )}
          <button
            type="button"
            aria-label={error && onRetry ? uit`Retry ${name}` : uit`Download ${name}`}
            onClick={error && onRetry ? onRetry : onDownload}
            className={cn(
              'absolute top-2 flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              onRemove ? 'right-10' : 'right-2',
            )}
          >
            {error && onRetry ? <RotateCcw className="size-3.5" /> : <Download className="size-3.5" />}
          </button>
          {onRemove && (
            <button
              type="button"
              aria-label={uit`Remove ${name}`}
              onClick={onRemove}
              className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {previewDialog}
      </>
    )
  }

  return (
    <>
      <div
        className={cn(
          'group/attachment relative size-24 overflow-hidden rounded-2xl border bg-muted/30 shadow-sm',
          error && 'border-destructive/50',
        )}
        title={error ?? (previewable ? uit`Preview ${name}` : name)}
      >
        {previewable ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label={uit`Preview ${name}`}
            className="size-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <PendingImageContent name={name} size={size} mimeType={mimeType} url={resolvedPreviewUrl} uploading={uploading} error={error} />
          </button>
        ) : (
          <div className="size-full">
            <PendingImageContent name={name} size={size} mimeType={mimeType} url={resolvedPreviewUrl} uploading={uploading} error={error} />
          </div>
        )}
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
          aria-label={error && onRetry ? uit`Retry ${name}` : uit`Download ${name}`}
          onClick={error && onRetry ? onRetry : onDownload}
          className="absolute top-1.5 left-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {error && onRetry ? <RotateCcw className="size-3" /> : <Download className="size-3" />}
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label={uit`Remove ${name}`}
            onClick={onRemove}
            className="absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {previewDialog}
    </>
  )
}

function PendingImageContent({
  name,
  size,
  mimeType,
  url,
  uploading,
  error,
}: {
  name: string
  size: number
  mimeType: string
  url: string | null
  uploading?: boolean
  error?: string | null
}) {
  return (
    <>
      <span className="block size-full">
        {url ? (
          <img src={url} alt={name} className="size-full object-cover" draggable={false} />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
            <ImageIcon className="size-5" />
            <span className="w-full truncate px-1 text-center text-[10px]">{name}</span>
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-left">
          <span className="block truncate text-[10px] font-medium text-white">{name}</span>
          <span className="block text-[9px] text-white/80">
            {error ? ui("Upload failed") : uploading ? ui("Uploading") : attachmentMeta(name, mimeType, size)}
          </span>
        </span>
      </span>
    </>
  )
}
