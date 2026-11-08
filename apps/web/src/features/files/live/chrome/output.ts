/**
 * Prints a page of our own HTML from a hidden frame, so only the document prints (the browser's
 * dialog also saves PDFs). The frame runs no scripts. Printing waits for its images.
 */
export function printHtmlDocument(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)
  const page = frame.contentDocument!
  page.open()
  page.write(html)
  page.close()
  const images = [...page.images].filter((image) => !image.complete)
  void Promise.all(images.map((image) => new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true })
    image.addEventListener('error', resolve, { once: true })
  }))).then(() => {
    setTimeout(() => {
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 1000)
    }, 50)
  })
}

/** Saves bytes the editor exported itself (a sheet as CSV) as a download. */
export function saveFile(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

const escapeHtml =(text: string) => text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!)

/** A plain text or code file as a printable page: monospaced, wrapped, titled with its name. */
export function textPrintHtml(title: string, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:1.5cm}body{margin:0;font:10pt/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#000}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;tab-size:4}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`
}
