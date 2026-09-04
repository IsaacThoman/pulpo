import { AppError } from '../lib/errors.js'
import { assertSafePublicHttpUrl, privateIp } from '../lib/url-security.js'
import { lookup } from 'node:dns'
import { Agent } from 'undici'

const MAX_HTML_BYTES = 512 * 1024
const MAX_REDIRECTS = 3

const publicNetworkAgent = new Agent({
  connect: {
    lookup: ((hostname: string, _options: unknown, callback: (error: Error | null, address?: string, family?: number) => void) => {
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) { callback(error); return }
        const publicAddress = addresses.find(({ address }) => !privateIp(address))
        if (!publicAddress || addresses.some(({ address }) => privateIp(address))) {
          callback(new Error('Private network address refused'))
          return
        }
        callback(null, publicAddress.address, publicAddress.family)
      })
    }) as never,
  },
})

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_all, number: string) => String.fromCodePoint(Number(number)))
    .replace(/\s+/g, ' ').trim()
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function metadata(html: string, url: URL) {
  const values = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const key = attribute(tag, 'property') ?? attribute(tag, 'name')
    const content = attribute(tag, 'content')
    if (key && content && !values.has(key.toLowerCase())) values.set(key.toLowerCase(), decodeEntities(content))
  }
  const rawTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, '') ?? ''
  return {
    url: url.toString(),
    title: (values.get('og:title') ?? decodeEntities(rawTitle) ?? url.hostname).slice(0, 300),
    description: (values.get('og:description') ?? values.get('description') ?? '').slice(0, 600),
    siteName: (values.get('og:site_name') ?? url.hostname).slice(0, 160),
  }
}

async function readLimitedHtml(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_HTML_BYTES) { await reader.cancel(); throw new AppError(413, 'link_preview_too_large', 'Link preview response is too large') }
    chunks.push(next.value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(result)
}

export async function fetchLinkPreview(value: string) {
  let url = await assertSafePublicHttpUrl(value)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9', 'user-agent': 'Pulpo-Link-Preview/1.0' },
      dispatcher: publicNetworkAgent,
    } as RequestInit & { dispatcher: Agent }).catch(() => { throw new AppError(422, 'link_preview_unavailable', 'Link preview could not be fetched') })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects === MAX_REDIRECTS) throw new AppError(422, 'link_preview_redirect', 'Link preview redirected too many times')
      url = await assertSafePublicHttpUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new AppError(422, 'link_preview_unavailable', 'Link preview could not be fetched')
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new AppError(422, 'link_preview_not_html', 'Link does not contain an HTML preview')
    return metadata(await readLimitedHtml(response), url)
  }
  throw new AppError(422, 'link_preview_unavailable', 'Link preview could not be fetched')
}
