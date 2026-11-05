/**
 * The system clipboard for copied shapes and slides: our payload under a web custom format plus
 * plain text for other apps. Browsers without custom formats get plain text only, and pastes
 * within the app fall back to the last copy while the clipboard still holds its text.
 */

const FORMAT = 'web application/x-pulpo-presentation+json'

let lastCopied: { json: string; text: string } | undefined

export async function writeClipboard(copied: { json: string; text: string }): Promise<void> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('unsupported')
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([copied.text], { type: 'text/plain' }), [FORMAT]: new Blob([copied.json], { type: FORMAT }) })])
  } catch {
    // Copying can await asset downloads, so the original copy event is no longer writable.
    // A failed write must reach cut callers before they delete the copied content.
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard writing is unavailable')
    await navigator.clipboard.writeText(copied.text)
  }
  lastCopied = copied
}

/** Our payload on the clipboard, if any. `text` is the clipboard's plain text, when the caller has it. */
export async function readClipboard(text?: string): Promise<string | undefined> {
  try {
    const items = await navigator.clipboard?.read?.()
    for (const item of items ?? []) {
      if (item.types.includes(FORMAT)) return await (await item.getType(FORMAT)).text()
    }
  } catch {
    // Permission denied or unsupported: fall back to the in-app copy.
  }
  if (!lastCopied) return undefined
  let current = text
  if (current === undefined) current = await navigator.clipboard?.readText?.().catch(() => undefined)
  // The in-app copy only counts while the system clipboard still holds what we copied.
  return current === undefined || current === lastCopied.text ? lastCopied.json : undefined
}
