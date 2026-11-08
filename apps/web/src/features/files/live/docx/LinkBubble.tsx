import { useEffect, useRef, useState } from 'react'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { Bookmark, Copy, Globe, Pencil, Unlink } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { useFileToasts } from '../../browser/toasts'
import { ToolbarButton } from './DocxToolbar'
import { OPENABLE_LINK, shortLink } from './link-targets'

interface BubbleState {
  href: string | null
  anchor: string | null
  left: number
  top: number
}

const BUBBLE_WIDTH = 320

/** Where the link at the caret is, in `container`'s scrolled coordinates, from the browser's selection. */
function caretLinkPosition(container: HTMLElement): { left: number; top: number } | null {
  const selection = document.getSelection()
  if (!selection?.rangeCount || !selection.anchorNode || !container.contains(selection.anchorNode)) return null
  const node = selection.anchorNode
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const link = element?.closest('a')
  const range = selection.getRangeAt(0)
  const rect = (link && container.contains(link) ? link.getClientRects()[0] : undefined) ?? range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) return null
  const box = container.getBoundingClientRect()
  const left = Math.max(8, Math.min(rect.left - box.left + container.scrollLeft, container.scrollLeft + container.clientWidth - Math.min(BUBBLE_WIDTH, container.clientWidth) - 8))
  return { left, top: rect.bottom - box.top + container.scrollTop + 6 }
}

/**
 * Docs' link bubble: while the caret is in a link, a small card under it shows where it goes
 * (opening in a new tab), with Copy, Edit, and Remove. It never takes focus from the document.
 */
export function LinkBubble({ editor, container, suppressed, onEdit, onRemove }: {
  editor: DocxEditor
  container: HTMLElement | null
  /** A dialog or menu is open: the bubble stays hidden. */
  suppressed: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const hidden = useRef(suppressed)
  hidden.current = suppressed
  const self = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container) return
    let frame = 0
    const compute = () => {
      frame = 0
      const link = !hidden.current && (editor.hasFocus || self.current?.contains(document.activeElement)) ? editor.linkAt() : null
      const position = link ? caretLinkPosition(container) : null
      const next = link && position ? { href: link.href, anchor: link.anchor, ...position } : null
      setBubble((current) => current && next && current.href === next.href && current.anchor === next.anchor && current.left === next.left && current.top === next.top ? current : next)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(compute) }
    const stops = [editor.on('update', schedule), editor.on('layout', schedule)]
    container.addEventListener('scroll', schedule, { passive: true })
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      for (const stop of stops) stop()
      container.removeEventListener('scroll', schedule)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
    }
  }, [editor, container])
  useEffect(() => { if (suppressed) setBubble(null) }, [suppressed])
  if (!bubble || suppressed) return null
  const target = bubble.href ?? (bubble.anchor ? `#${bubble.anchor}` : '')
  const editable = editor.state().untrackedFormattingEditable
  const keep = (event: React.MouseEvent) => event.preventDefault()
  return (
    <div
      ref={self}
      role="group"
      aria-label={ui("Link")}
      className="absolute z-20 flex max-w-[min(20rem,calc(100%-1rem))] items-center gap-1 rounded-lg border bg-popover py-1 pr-1 pl-2.5 text-sm text-popover-foreground shadow-md"
      style={{ left: bubble.left, top: bubble.top }}
      onMouseDown={keep}
      data-docx-link-bubble=""
    >
      {bubble.href ? <Globe className="size-3.5 shrink-0 text-muted-foreground" /> : <Bookmark className="size-3.5 shrink-0 text-muted-foreground" />}
      {bubble.href && OPENABLE_LINK.test(bubble.href) ? (
        <a href={bubble.href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline" title={bubble.href}>
          {shortLink(bubble.href)}
        </a>
      ) : bubble.anchor ? (
        <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left text-primary hover:underline" onClick={() => editor.goToBookmark(bubble.anchor!)}>
          {ui("Go to {{name}}", { name: bubble.anchor })}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{target}</span>
      )}
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      {bubble.href && (
        <ToolbarButton label={ui("Copy link")} onClick={() => {
          void navigator.clipboard?.writeText(bubble.href!).then(
            () => useFileToasts.getState().show({ message: ui("Link copied") }),
            () => useFileToasts.getState().show({ message: ui("Couldn't copy the link"), tone: 'error' }),
          )
        }}>
          <Copy className="size-3.5" />
        </ToolbarButton>
      )}
      {editable && (
        <>
          <ToolbarButton label={ui("Edit link")} onClick={onEdit}><Pencil className="size-3.5" /></ToolbarButton>
          <ToolbarButton label={ui("Remove link")} onClick={onRemove}><Unlink className="size-3.5" /></ToolbarButton>
        </>
      )}
    </div>
  )
}
