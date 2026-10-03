import { useCallback, useMemo, useState } from 'react'
import { TableVirtuoso, type TableComponents } from 'react-virtuoso'
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
import {
  attachmentPreviewKind,
  createDelimitedReader,
  formatTextPreview,
  type AttachmentPreviewKind,
} from '@/lib/attachment-previews'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { attachmentDescription, usePreviewContent, type PreviewContent } from './use-attachment-preview-content'
import { SandboxFrame } from '@/components/chat/SandboxFrame'
import { CodeSource, PreviewModeToggle } from '@/components/chat/CodePreviewPanel'
import { HighlightedCode } from '@/components/chat/HighlightedCode'
import { previewKindForFile } from '@/lib/code-preview'
import { languageForFile } from '@/lib/syntax-highlight'

const TABLE_ROW_BATCH = 200

// Stable component identities, so loading a batch does not remount the table.
const tableComponents: TableComponents<string[]> = {
  Table: (props) => <table {...props} className="min-w-full border-separate border-spacing-0 whitespace-nowrap text-left text-xs" />,
  TableRow: ({ item: _item, ...props }) => <tr {...props} className="odd:bg-muted/20 hover:bg-muted/35" />,
}

function TablePreview({ attachment, text }: { attachment: Attachment; text: string }) {
  // The reader is created inside the initializer so StrictMode's double call cannot consume a batch twice.
  const [{ reader, firstRows }] = useState(() => {
    const reader = createDelimitedReader(attachment.name, attachment.mimeType, text)!
    return { reader, firstRows: reader.next(TABLE_ROW_BATCH) }
  })
  const [rows, setRows] = useState(firstRows)
  const [done, setDone] = useState(reader.done)
  const loadMore = useCallback(() => {
    if (reader.done) return
    const batch = reader.next(TABLE_ROW_BATCH)
    setRows((current) => current.concat(batch))
    setDone(reader.done)
  }, [reader])
  const loaded = rows.length.toLocaleString(activeLocale())
  const columns = reader.headers.length.toLocaleString(activeLocale())

  return (
    <div className="flex size-full flex-col bg-background" data-preview-kind="table">
      <TableVirtuoso
        className="min-h-0 flex-1"
        data={rows}
        endReached={loadMore}
        increaseViewportBy={400}
        initialItemCount={Math.min(rows.length, 50)}
        components={tableComponents}
        fixedHeaderContent={() => (
          <tr className="bg-muted/95 backdrop-blur">
            <th className="w-px border-r border-b px-2 py-1.5 text-right font-normal text-muted-foreground tabular-nums">#</th>
            {reader.headers.map((header, column) => (
              <th key={column} title={header} className="max-w-72 truncate border-r border-b px-3 py-1.5 font-semibold last:border-r-0">
                {header}
              </th>
            ))}
          </tr>
        )}
        itemContent={(rowIndex, row) => (
          <>
            <td className="w-px border-r border-b px-2 py-1.5 text-right text-muted-foreground tabular-nums">{rowIndex + 1}</td>
            {row.map((value, column) => (
              <td key={column} title={value || undefined} className="max-w-72 truncate border-r border-b px-3 py-1.5 last:border-r-0">
                {value}
              </td>
            ))}
          </>
        )}
      />
      <p className="shrink-0 border-t bg-background/95 px-3 py-2 text-xs text-muted-foreground tabular-nums" role="status">
        {done
          ? uit`${loaded} rows · ${columns} columns`
          : uit`${loaded} rows loaded · ${columns} columns · scroll for more`}
      </p>
    </div>
  )
}

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
    <div className="size-full overflow-auto bg-code text-code-foreground" data-preview-kind="text">
      <pre className="code-highlight min-h-full p-5 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
        <HighlightedCode code={text} language={languageForFile(attachment.name, attachment.mimeType)} />
      </pre>
      {truncated && (
        <p className="sticky bottom-0 border-t border-code-border bg-code/95 px-5 py-2 text-xs text-code-muted backdrop-blur"> {ui("Showing the first part of")} {attachment.name}.
        </p>
      )}
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

export function PreviewBody({
  attachment,
  kind,
  content,
}: {
  attachment: Attachment
  kind: AttachmentPreviewKind
  content: PreviewContent
}) {
  const isTable = useMemo(() => content.status === 'ready' && kind === 'table' && !!content.text
    && createDelimitedReader(attachment.name, attachment.mimeType, content.text) !== null,
  [attachment.mimeType, attachment.name, content, kind])

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
  if (isTable && content.text !== null) return <TablePreview key={attachment.id} attachment={attachment} text={content.text} />
  if (kind === 'table' && content.text !== null) {
    // Single-column files are not really tables; show them as text, capped like any other text preview.
    const fallback = formatTextPreview(attachment.name, attachment.mimeType, content.text)
    return <TextPreview attachment={attachment} text={fallback.text} truncated={fallback.truncated} markdown={false} />
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
          {content.status === 'ready' && content.text !== null && !content.textTruncated && (
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
