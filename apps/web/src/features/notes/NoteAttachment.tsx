/* oxlint-disable react/only-export-components -- Tiptap node views are defined beside their extension. */
import { useEffect, useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { apiRequest, downloadApiFile, fetchApiBlob } from '@/lib/api'
import { ui } from '@/i18n/ui'

export interface NoteAttachmentAttrs {
  attachmentId: string
  name: string
  mimeType: string
  sizeBytes: number
  kind: 'image' | 'file'
}

function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentView({ node, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as NoteAttachmentAttrs
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(attrs.kind === 'image')
  useEffect(() => {
    if (attrs.kind !== 'image') return
    let url: string | null = null
    let cancelled = false
    void fetchApiBlob(`/api/attachments/${attrs.attachmentId}/thumbnail`)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setImageUrl(url)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [attrs.attachmentId, attrs.kind])

  if (attrs.kind === 'image') {
    return <NodeViewWrapper className={`note-attachment-image ${selected ? 'is-selected' : ''}`} data-drag-handle>
      {loading ? <div className="grid h-44 place-items-center rounded-lg bg-muted"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : imageUrl ? (
        <img src={imageUrl} alt={attrs.name} className="max-h-[34rem] max-w-full rounded-lg border object-contain" />
      ) : <div className="rounded-lg border p-6 text-sm text-muted-foreground">{ui('Image preview unavailable')}</div>}
      <span className="mt-1 block text-xs text-muted-foreground">{attrs.name}</span>
    </NodeViewWrapper>
  }
  return <NodeViewWrapper className={`note-attachment-file ${selected ? 'is-selected' : ''}`} data-drag-handle>
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border bg-muted/35 p-3 text-left hover:bg-muted/60"
      onClick={() => void apiRequest<{ url: string }>(`/api/attachments/${attrs.attachmentId}/download`)
        .then(({ url }) => downloadApiFile(url, attrs.name))}
    >
      <FileText className="size-6 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{attrs.name}</span><span className="text-xs text-muted-foreground">{readableBytes(attrs.sizeBytes)}</span></span>
      <Download className="size-4 text-muted-foreground" />
    </button>
  </NodeViewWrapper>
}

function decodeAttribute(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

export const NoteAttachment = Node.create({
  name: 'noteAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: { default: '' },
      name: { default: '' },
      mimeType: { default: 'application/octet-stream' },
      sizeBytes: { default: 0 },
      kind: { default: 'file' },
    }
  },
  parseHTML() { return [{ tag: 'figure[data-pulpo-attachment]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, {
      'data-pulpo-attachment': HTMLAttributes.attachmentId,
      class: 'note-attachment-placeholder',
    }), HTMLAttributes.name]
  },
  markdownTokenName: 'noteAttachment',
  markdownTokenizer: {
    name: 'noteAttachment',
    level: 'block',
    start: '<figure data-pulpo-attachment=',
    tokenize(src) {
      const match = /^<figure\s+data-pulpo-attachment="[^"]+"\s+data-name="[^"]*"\s+data-mime-type="[^"]*"\s+data-size-bytes="\d+"\s+data-kind="(?:image|file)"\s*><\/figure>\s*/i.exec(src)
      return match ? { type: 'noteAttachment', raw: match[0], text: match[0] } : undefined
    },
  },
  parseMarkdown(token, helpers) {
    const raw = token.raw ?? token.text ?? ''
    const match = /<figure\s+data-pulpo-attachment="([^"]+)"\s+data-name="([^"]*)"\s+data-mime-type="([^"]*)"\s+data-size-bytes="(\d+)"\s+data-kind="(image|file)"\s*><\/figure>/i.exec(raw)
    if (!match) return helpers.createNode('paragraph', {}, [helpers.createTextNode(raw)])
    return helpers.createNode('noteAttachment', {
      attachmentId: decodeAttribute(match[1]), name: decodeAttribute(match[2]), mimeType: decodeAttribute(match[3]), sizeBytes: Number(match[4]), kind: match[5],
    })
  },
  renderMarkdown(node) {
    const attrs = node.attrs as NoteAttachmentAttrs
    return `<figure data-pulpo-attachment="${encodeURIComponent(attrs.attachmentId)}" data-name="${encodeURIComponent(attrs.name)}" data-mime-type="${encodeURIComponent(attrs.mimeType)}" data-size-bytes="${attrs.sizeBytes}" data-kind="${attrs.kind}"></figure>`
  },
  addNodeView() { return ReactNodeViewRenderer(AttachmentView) },
})
