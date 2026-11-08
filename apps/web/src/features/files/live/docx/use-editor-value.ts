import { useEffect, useRef, useState } from 'react'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'

/**
 * Re-reads a value from the editor whenever it updates (and on layout): on the next frame, or,
 * with `delay`, at most once per `delay` ms, for reads that walk the whole document or measure
 * the layout (word counts, the cursor's page).
 */
export function useEditorValue<T>(editor: DocxEditor, read: () => T, delay = 0): T {
  const [value, setValue] = useState(read)
  const reader = useRef(read)
  reader.current = read
  useEffect(() => {
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      timer = undefined
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setValue(reader.current())
      })
    }
    const refresh = () => {
      if (!delay) return run()
      if (!timer) timer = setTimeout(run, delay)
    }
    const stops = [editor.on('update', refresh), editor.on('layout', refresh), editor.on('activeComment', refresh)]
    run()
    return () => {
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [editor, delay])
  return value
}
