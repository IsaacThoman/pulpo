import { normalizeSearchHandoffSource } from '@pulpo/contracts/search'
import { z } from 'zod'
import { resultSnippet, shortenResultText } from '../agent/search-results.js'

const fastGptUrl = 'https://kagi.com/api/v0/fastgpt'
const maximumResponseBytes = 128 * 1024
const maximumAnswerLength = 4_000
const maximumReferences = 12
const timeoutMs = 15_000

export const quickAnswerInput = z.strictObject({ query: z.string().trim().min(1).max(500) })

const fastGptResponse = z.object({
  data: z.object({ output: z.string(), references: z.array(z.unknown()) }),
  error: z.array(z.unknown()).max(0).nullish(),
})
const fastGptReference = z.object({ url: z.string(), title: z.unknown().optional(), snippet: z.unknown().optional() })

function plainText(value: string) {
  const lines = value.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|hr)\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .split(/\r\n?|\n/)
  const text = lines.map(line => {
    const clean = resultSnippet(line, maximumAnswerLength).replace(/\p{Cc}/gu, '').trim()
    const marker = /^\s*([-+*]|\d+[.)])\s+/.exec(line)?.[1]
    return clean && marker ? `${marker} ${clean}` : clean
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return shortenResultText(text, maximumAnswerLength)
}

async function readFastGptResponse(response: Response): Promise<unknown> {
  const body = response.body
  if (!response.ok || !body || Number(response.headers.get('content-length')) > maximumResponseBytes) {
    await body?.cancel().catch(() => {})
    throw new Error('Quick Answer response unavailable')
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumResponseBytes) throw new Error('Quick Answer response exceeds the size limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
  } catch {
    throw new Error('Unexpected Quick Answer response')
  }
}

export async function searchQuickAnswer(query: string, apiKey: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  const response = await fetch(fastGptUrl, {
    method: 'POST', redirect: 'error', signal: requestSignal,
    headers: { accept: 'application/json', authorization: `Bot ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const parsed = fastGptResponse.safeParse(await readFastGptResponse(response))
  requestSignal.throwIfAborted()
  if (!parsed.success) throw new Error('Unexpected Quick Answer response')
  const { output, references: upstreamReferences } = parsed.data.data
  const answer = plainText(output)
  const references = upstreamReferences.slice(0, maximumReferences).flatMap((reference, index) => {
    const row = fastGptReference.safeParse(reference)
    if (!row.success) return []
    const url = normalizeSearchHandoffSource(row.data.url)
    if (!url) return []
    const title = resultSnippet(row.data.title, 180).replace(/\p{Cc}/gu, '').trim()
    const snippet = resultSnippet(row.data.snippet, 245).replace(/\p{Cc}/gu, '').trim()
    return [{ index: index + 1, url: url.href, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) }]
  })
  if (!answer || !references.length) throw new Error('Quick Answer has no sourced answer')
  requestSignal.throwIfAborted()
  return { provider: 'kagi' as const, answer, references }
}
