/* oxlint-disable react/only-export-components -- Tiptap node views are defined beside their extension. */
import { ExternalLink, Globe2 } from 'lucide-react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { openExternalUrl } from '@/lib/runtime'

interface PreviewAttrs { url: string; title: string; description: string; siteName: string }

function PreviewView({ node, selected }: ReactNodeViewProps) {
  const preview = node.attrs as PreviewAttrs
  return <NodeViewWrapper className={selected ? 'ProseMirror-selectednode' : ''}>
    <button type="button" className="my-4 flex w-full cursor-pointer items-start gap-3 rounded-xl border bg-muted/25 p-4 text-left hover:bg-muted/50" onClick={() => void openExternalUrl(preview.url)}>
      <Globe2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{preview.title || preview.url}</span>{preview.description && <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{preview.description}</span>}<span className="mt-2 block truncate text-[11px] text-muted-foreground">{preview.siteName}</span></span>
      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
    </button>
  </NodeViewWrapper>
}

const encode = (value: string) => encodeURIComponent(value)
const decode = (value: string) => { try { return decodeURIComponent(value) } catch { return value } }

export const NoteLinkPreview = Node.create({
  name: 'noteLinkPreview',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { url: { default: '' }, title: { default: '' }, description: { default: '' }, siteName: { default: '' } } },
  parseHTML() { return [{ tag: 'aside[data-pulpo-link-preview]' }] },
  renderHTML({ HTMLAttributes }) { return ['aside', mergeAttributes(HTMLAttributes, { 'data-pulpo-link-preview': HTMLAttributes.url }), HTMLAttributes.title] },
  markdownTokenName: 'noteLinkPreview',
  markdownTokenizer: {
    name: 'noteLinkPreview', level: 'block', start: '<aside data-pulpo-link-preview=',
    tokenize(src) {
      const match = /^<aside\s+data-pulpo-link-preview="[^"]*"\s+data-title="[^"]*"\s+data-description="[^"]*"\s+data-site-name="[^"]*"\s*><\/aside>\s*/i.exec(src)
      return match ? { type: 'noteLinkPreview', raw: match[0], text: match[0] } : undefined
    },
  },
  parseMarkdown(token, helpers) {
    const raw = token.raw ?? token.text ?? ''
    const match = /<aside\s+data-pulpo-link-preview="([^"]*)"\s+data-title="([^"]*)"\s+data-description="([^"]*)"\s+data-site-name="([^"]*)"\s*><\/aside>/i.exec(raw)
    if (!match) return helpers.createNode('paragraph', {}, [helpers.createTextNode(raw)])
    return helpers.createNode('noteLinkPreview', { url: decode(match[1] ?? ''), title: decode(match[2] ?? ''), description: decode(match[3] ?? ''), siteName: decode(match[4] ?? '') })
  },
  renderMarkdown(node) {
    const attrs = node.attrs as PreviewAttrs
    return `<aside data-pulpo-link-preview="${encode(attrs.url)}" data-title="${encode(attrs.title)}" data-description="${encode(attrs.description)}" data-site-name="${encode(attrs.siteName)}"></aside>`
  },
  addNodeView() { return ReactNodeViewRenderer(PreviewView) },
})
