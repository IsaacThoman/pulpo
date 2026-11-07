import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { DocxEditor, type DocxFormattingState, type DocxLayout } from '@pulpo/client-core/office/docx/view'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { docxLabels } from './docx-labels'

export interface DocxEditorProps {
  doc: Y.Doc
  awareness: Awareness
  assets: LiveAssetStore
  user: { name: string; color: string }
  readOnly?: boolean
  layout?: DocxLayout
}

/** Mounts the editor core into `host` for the lifetime of the document. */
export function useDocxEditor(host: React.RefObject<HTMLDivElement | null>, { doc, awareness, assets, user, readOnly, layout }: DocxEditorProps): DocxEditor | null {
  const [editor, setEditor] = useState<DocxEditor | null>(null)
  const initial = useRef({ user, readOnly, layout })
  useEffect(() => {
    const container = host.current
    if (!container) return
    const created = new DocxEditor({ container, doc, awareness, assets, user: initial.current.user, readOnly: initial.current.readOnly, layout: initial.current.layout, labels: docxLabels() })
    setEditor(created)
    return () => {
      created.destroy()
      setEditor(null)
    }
  }, [host, doc, awareness, assets])
  useEffect(() => {
    editor?.setReadOnly(Boolean(readOnly))
  }, [editor, readOnly])
  return editor
}

const EMPTY: DocxFormattingState | null = null

/** The editor's formatting state, re-read at most once per frame. */
export function useDocxState(editor: DocxEditor | null): DocxFormattingState | null {
  const cache = useRef<{ editor: DocxEditor | null; state: DocxFormattingState | null; stale: boolean }>({ editor: null, state: null, stale: true })
  return useSyncExternalStore(
    (notify) => {
      if (!editor) return () => {}
      let frame = 0
      return editor.on('update', () => {
        cache.current.stale = true
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          notify()
        })
      })
    },
    () => {
      if (!editor) return EMPTY
      const current = cache.current
      if (current.editor !== editor || current.stale) {
        current.editor = editor
        current.state = editor.state()
        current.stale = false
      }
      return current.state
    },
  )
}
