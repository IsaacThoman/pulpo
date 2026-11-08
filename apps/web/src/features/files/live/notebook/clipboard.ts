/**
 * The system clipboard, as copying cells leaves it. Ctrl/Cmd+V in command mode pastes the cells
 * copied on this page when the clipboard holds their text, and any other text as a new cell, so
 * the cells' text must reach it. It goes there as the browser copies (`copyCells`), which cannot
 * fail; where the browser will not, it is written afterwards, which is asynchronous and can fail
 * (no permission, or no clipboard API outside a secure context). Until that write succeeds, the
 * clipboard still holds older text, and Ctrl+V pastes the copied cells instead.
 */
let offClipboard = false
let writes = 0

/** Puts text on the system clipboard; `cells` for copied cells' text, written even when empty (an empty cell). */
export function writeClipboard(text: string, cells = false): void {
  if (!text && !cells) return
  const write = ++writes
  offClipboard = cells
  void navigator.clipboard?.writeText(text).then(() => {
    if (write === writes) offClipboard = false
  }, () => undefined)
}

/**
 * Copies cells: `take` copies (or cuts) them in the notebook and gives their text, which the
 * browser's copy event puts on the clipboard as it happens. It is taken before anything else sees
 * it (a cell's editor would copy text left selected in it). Call it from a key press or a click.
 */
export function copyCells(take: () => string): void {
  let text: string | null = null
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.preventDefault()
    event.stopImmediatePropagation()
    text = take()
    event.clipboardData.setData('text/plain', text)
  }
  window.addEventListener('copy', onCopy, true)
  try {
    // WebKit reports false with nothing selected, but still copies what the event set.
    document.execCommand('copy')
  } catch {
    // No copy command (jsdom).
  } finally {
    window.removeEventListener('copy', onCopy, true)
  }
  if (text === null) writeClipboard(take(), true)
  else clipboardChanged()
}

/** Whether the cells copied last may not be on the system clipboard yet, or will not be. */
export function cellsOffClipboard(): boolean {
  return offClipboard
}

/** Something else went to the system clipboard (a copy on the page), or may have (in another app). */
export function clipboardChanged(): void {
  writes += 1
  offClipboard = false
}
