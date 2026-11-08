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

/**
 * What a menu's Paste can use, read from the system clipboard (browsers may ask for permission):
 * our payload (or the last in-app copy while the clipboard still holds its text), an image, text.
 */
export async function readClipboardContents(): Promise<{ payload?: string; image?: Blob; text?: string }> {
  let payload: string | undefined
  let image: Blob | undefined
  let text: string | undefined
  try {
    for (const item of (await navigator.clipboard?.read?.()) ?? []) {
      if (payload === undefined && item.types.includes(FORMAT)) payload = await (await item.getType(FORMAT)).text()
      const imageType = item.types.find((type) => type.startsWith('image/'))
      if (!image && imageType) image = await item.getType(imageType)
      if (text === undefined && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text()
    }
  } catch {
    // Permission denied or unsupported: plain text may still be readable.
  }
  if (text === undefined && payload === undefined && !image) text = await navigator.clipboard?.readText?.().catch(() => undefined)
  if (payload === undefined && lastCopied && (text === undefined || text === lastCopied.text) && !image) payload = lastCopied.json
  return { ...(payload !== undefined ? { payload } : {}), ...(image ? { image } : {}), ...(text ? { text } : {}) }
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
