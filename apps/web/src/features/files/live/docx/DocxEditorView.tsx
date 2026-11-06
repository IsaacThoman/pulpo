import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { CommentsPanel, FindBar, OutlinePanel, ReviewPanel, StatusBar } from './DocxPanels'
import { DocxToolbar, type ToolbarPanels } from './DocxToolbar'
import { useDocxEditor, useDocxState, type DocxEditorProps } from './use-docx-editor'

/**
 * A Word document editor: toolbar, page canvas, and the outline, comments, and tracked changes
 * panels around the client-core editor. The document, its awareness, and its assets come from
 * the host (the Files page, or the test harness).
 */
export function DocxEditorView({ className, onEditor, toolbarSlot, ...props }: DocxEditorProps & { className?: string; onEditor?: (editor: DocxEditor | null) => void; toolbarSlot?: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useDocxEditor(host, props)
  const state = useDocxState(editor)
  const [panels, setPanels] = useState<ToolbarPanels>({ outline: false, comments: false, review: false })
  const [find, setFind] = useState<'find' | 'replace' | null>(null)
  useEffect(() => { onEditor?.(editor) }, [editor, onEditor])

  const requestLink = useCallback(() => {
    if (!editor?.state().untrackedFormattingEditable) return
    const href = window.prompt(ui("Link URL"), editor.state().link ?? 'https://')
    if (href === null) return
    const trimmed = href.trim()
    if (!trimmed) editor.setLink(null)
    else if (/^(https?:|mailto:)/i.test(trimmed)) editor.setLink(trimmed)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const stopRequest = editor.on('request', (request) => {
      if (request === 'link') requestLink()
      else if (request === 'find' || request === 'replace') setFind(request)
      else if (request === 'comment') setPanels((current) => ({ ...current, comments: true }))
    })
    const stopComment = editor.on('activeComment', (id) => {
      if (id) setPanels((current) => (current.comments ? current : { ...current, comments: true }))
    })
    return () => {
      stopRequest()
      stopComment()
    }
  }, [editor, requestLink])

  const togglePanel = (panel: keyof ToolbarPanels) => setPanels((current) => ({ ...current, [panel]: !current[panel] }))

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)} data-docx-editor>
      <div className="z-10 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
        {editor && state ? (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><DocxToolbar editor={editor} state={state} onRequestLink={requestLink} onTogglePanel={togglePanel} panels={panels} /></div>
            {toolbarSlot}
          </div>
        ) : (
          <div className="h-8" />
        )}
      </div>
      {editor && find && <FindBar editor={editor} replaceOpen={find === 'replace'} onClose={() => setFind(null)} />}
      <div className="flex min-h-0 flex-1">
        {editor && panels.outline && <OutlinePanel editor={editor} onClose={() => togglePanel('outline')} />}
        <div className="relative min-w-0 flex-1 overflow-auto bg-muted [--docx-desk:var(--muted)]" data-docx-scroller>
          <div ref={host} className="min-w-fit" />
        </div>
        {editor && panels.comments && <CommentsPanel editor={editor} onClose={() => togglePanel('comments')} />}
        {editor && panels.review && <ReviewPanel editor={editor} onClose={() => togglePanel('review')} />}
      </div>
      {editor && <StatusBar editor={editor} />}
    </div>
  )
}
