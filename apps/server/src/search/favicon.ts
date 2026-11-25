import { isSearchFaviconHost } from '@pulpo/contracts/search'

const maxBytes = 64 * 1024
const imageTypes = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export async function fetchSearchFavicon(host: string) {
  if (!isSearchFaviconHost(host)) return null
  try {
    const response = await fetch('https://icons.duckduckgo.com/ip3/' + host + '.ico', {
      redirect: 'error',
      signal: AbortSignal.timeout(2500),
      headers: { accept: 'image/*' },
    })
    const type = response.headers.get('content-type')?.split(';')[0]?.trim()
    if (!response.ok || !type || !imageTypes.has(type) || Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel()
      return null
    }
    if (!response.body) return null
    const reader = response.body.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        return null
      }
      parts.push(next.value)
    }
    return size ? { type, data: Buffer.concat(parts, size) } : null
  } catch {
    return null
  }
}
