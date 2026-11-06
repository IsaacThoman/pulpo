import { useMemo, useState } from 'react'
import { Check, Copy, Download, FileWarning, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/chat/Markdown'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Attachment } from '@/lib/types'
import { writeClipboardText } from '@/lib/clipboard'
import { attachmentPreviewKind, type AttachmentPreviewKind } from '@/lib/attachment-previews'
import { ui, uit } from '@/i18n/ui'
import { attachmentDescription, usePreviewContent, type PreviewContent } from './use-attachment-preview-content'
import { SandboxFrame } from '@/components/chat/SandboxFrame'
import { CodeSource, PreviewModeToggle } from '@/components/chat/CodePreviewPanel'
import { previewKindForFile } from '@/lib/code-preview'
import { parseQuiz } from '@pulpo/client-core/quiz'
import { QuizCard } from '@/components/chat/QuizCard'
import { languageForFile } from '@/lib/syntax-highlight'
import { CodeViewer } from '@/components/viewers/CodeViewer'
import { DelimitedGrid } from '@/components/viewers/DelimitedGrid'
import { NotebookViewer } from '@/components/viewers/NotebookViewer'

function TextPreview({
  attachment,
  text,
  truncated,
  markdown,
}: {
  attachment: Attachment
  text: string
  truncated: boolean
  markdown: boolean
}) {
  if (markdown) {
    return (
      <div className="size-full overflow-auto bg-background" data-preview-kind="markdown">
        <article className="mx-auto min-h-full w-full max-w-4xl p-6 text-sm sm:p-8">
          <Markdown content={text} />
        </article>
        {truncated && (
          <p className="sticky bottom-0 border-t bg-background/95 px-5 py-2 text-xs text-muted-foreground backdrop-blur"> {ui("Showing the first part of")} {attachment.name}.
          </p>
        )}
      </div>
    )
  }

  return (
    <CodeViewer
      text={text}
      name={attachment.name}
      mimeType={attachment.mimeType}
      notice={truncated ? <>{ui("Showing the first part of")} {attachment.name}.</> : undefined}
    />
  )
}

function QuizPreview({ attachment, text, truncated }: { attachment: Attachment; text: string; truncated: boolean }) {
  const quiz = useMemo(() => truncated ? null : parseQuiz(text), [text, truncated])
  if (!quiz) return <TextPreview attachment={attachment} text={text} truncated={truncated} markdown={false} />
  return (
    <div className="size-full overflow-auto bg-background" data-preview-kind="quiz">
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <QuizCard quiz={quiz} progressKey={`attachment:${attachment.id}`} className="my-0" />
      </div>
    </div>
  )
}

function SandboxPreview({ attachment, text, truncated }: { attachment: Attachment; text: string; truncated: boolean }) {
  const [mode, setMode] = useState<'preview' | 'code'>(truncated ? 'code' : 'preview')
  const kind = previewKindForFile(attachment.name, attachment.mimeType)
  return (
    <div className="flex size-full flex-col" data-preview-kind="sandbox">
      {!truncated && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5">
          <PreviewModeToggle mode={mode} onChange={setMode} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        {mode === 'preview' && kind
          ? <SandboxFrame kind={kind} code={text} title={uit`Preview of ${attachment.name}`} />
          : <CodeSource code={text} language={languageForFile(attachment.name, attachment.mimeType)} />}
      </div>
    </div>
  )
}

/** Viewers with their own toolbar (copy, find) where the dialog's copy button would repeat theirs. */
function hasViewerToolbar(kind: AttachmentPreviewKind): boolean {
  return kind === 'text' || kind === 'table' || kind === 'notebook'
}

export function PreviewBody({
  attachment,
  kind,
  content,
}: {
  attachment: Attachment
  kind: AttachmentPreviewKind
  content: PreviewContent
}) {
  if (content.status === 'idle' || content.status === 'loading') {
    return (
      <div role="status" className="flex size-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin" /> {ui("Loading preview…")} </div>
    )
  }
  if (content.status === 'error') {
    return (
      <div role="alert" className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <FileWarning className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium">{ui("Preview unavailable")}</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{content.message}</p>
        </div>
      </div>
    )
  }
  if (kind === 'sandbox' && content.text !== null) {
    return <SandboxPreview attachment={attachment} text={content.text} truncated={content.textTruncated} />
  }
  if (kind === 'table' && content.text !== null) {
    return <DelimitedGrid key={attachment.id} text={content.text} name={attachment.name} mimeType={attachment.mimeType} />
  }
  if (kind === 'notebook' && content.text !== null) return <NotebookViewer key={attachment.id} text={content.text} name={attachment.name} />
  if (kind === 'quiz' && content.text !== null) {
    return <QuizPreview attachment={attachment} text={content.text} truncated={content.textTruncated} />
  }
  if ((kind === 'markdown' || kind === 'text') && content.text !== null) {
    return <TextPreview attachment={attachment} text={content.text} truncated={content.textTruncated} markdown={kind === 'markdown'} />
  }
  if (!content.url) return null
  if (kind === 'image') {
    return <img src={content.url} alt={attachment.name} className="size-full object-contain p-4" data-preview-kind="image" draggable={false} />
  }
  if (kind === 'pdf') {
    return <iframe src={content.url} title={uit`Preview of ${attachment.name}`} className="size-full bg-white" data-preview-kind="pdf" />
  }
  if (kind === 'audio') {
    return (
      <div className="flex size-full items-center justify-center bg-gradient-to-br from-fuchsia-500/10 via-background to-violet-500/10 p-6" data-preview-kind="audio">
        <audio src={content.url} controls preload="metadata" aria-label={uit`Audio preview of ${attachment.name}`} className="w-full max-w-xl" />
      </div>
    )
  }
  return <video src={content.url} controls preload="metadata" aria-label={uit`Video preview of ${attachment.name}`} className="size-full bg-black object-contain" data-preview-kind="video" />
}

export function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="rounded-full"
      aria-label={copied ? ui("Copied") : ui("Copy text")}
      onClick={() => {
        void writeClipboardText(text).then((success) => {
          if (!success) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  )
}

export function AttachmentPreviewDialog({
  attachment,
  sourceFile,
  open,
  onOpenChange,
  onDownload,
}: {
  attachment: Attachment
  sourceFile?: File
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => void
}) {
  const kind = attachmentPreviewKind(attachment.name, attachment.mimeType)
  const content = usePreviewContent(attachment, kind, open, sourceFile)
  if (!kind) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Escape in a viewer's find bar closes the find bar, not the preview.
        onEscapeKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest('[data-viewer-find]')) event.preventDefault()
        }}
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
          {/* Truncated previews only hold the start of the file, so copying would silently drop the rest. */}
          {content.status === 'ready' && content.text !== null && !content.textTruncated && !hasViewerToolbar(kind) && (
            <CopyTextButton text={content.text} />
          )}
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDownload} aria-label={uit`Download ${attachment.name}`} className="rounded-full">
            <Download className="size-4" />
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={ui("Close preview")} className="rounded-full">
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
