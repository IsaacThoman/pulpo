import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { createHash } from 'node:crypto'
import { addAbortListener } from 'node:events'
import { z } from 'zod'
import { resultText, resultUrl } from '../agent/search-results.js'

// Openverse search and thumbnail API: https://api.openverse.org/v1/
// Attribution and source license verification: https://docs.openverse.org/terms_of_service
const openverseImagesEndpoint = 'https://api.openverse.org/v1/images/'
const pageSize = 20
const maximumPage = 10
const maximumResponseBytes = 512 * 1024
const timeoutMs = 20_000
const cacheTtlMs = 60_000
const maximumCachedPages = 32
const imageCategories = ['photograph', 'illustration', 'digitized_artwork'] as const
const licenseCodes = ['by', 'by-nc', 'by-nc-nd', 'by-nc-sa', 'by-nd', 'by-sa', 'cc0', 'nc-sampling+', 'pdm', 'sampling+'] as const
type LicenseCode = (typeof licenseCodes)[number]
const licenseGroupOptions = ['public-domain', 'commercial', 'modification'] as const
const licenseGroups: Record<(typeof licenseGroupOptions)[number], readonly LicenseCode[]> = {
  'public-domain': ['cc0', 'pdm'],
  commercial: ['by', 'by-nd', 'by-sa', 'cc0', 'pdm'],
  modification: ['by', 'by-nc', 'by-nc-sa', 'by-sa', 'cc0', 'pdm'],
}

export const reusableImagesInput = z.strictObject({
  query: z.string().trim().min(1).max(200).regex(/^[^\p{Cc}]+$/u),
  page: z.number().int().min(1).max(maximumPage).optional(),
  license: z.enum(licenseGroupOptions).optional(),
  category: z.enum(imageCategories).optional(),
})
type ReusableImagesInput = z.infer<typeof reusableImagesInput>

export interface ReusableImage {
  id: string
  title: string
  imageUrl: string
  thumbnailUrl: string
  sourceUrl: string
  license: { code: LicenseCode; version?: string; url: string }
  creator?: string
  creatorUrl?: string
  attribution?: string
  source?: string
  category?: (typeof imageCategories)[number]
  width?: number
  height?: number
}

export interface ReusableImagesResponse {
  provider: 'openverse'
  page: number
  hasMore: boolean
  results: ReusableImage[]
}

export class ReusableImagesRateLimitError extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super('Openverse rate limit reached')
    this.name = 'ReusableImagesRateLimitError'
  }
}

const providerMessages = {
  timeout: 'Openverse took too long to respond. Try again or switch to All images.',
  network: 'Could not reach Openverse. Try again or switch to All images.',
  http: 'Openverse response unavailable',
  'invalid-response': 'Unexpected Openverse response',
  'body-limit': 'Openverse response exceeds the size limit',
}

export class ReusableImagesProviderError extends Error {
  constructor(readonly category: keyof typeof providerMessages, readonly status?: number) {
    super(providerMessages[category])
    this.name = 'ReusableImagesProviderError'
  }
}

interface PendingPage {
  controller: AbortController
  result: Promise<ReusableImagesResponse>
  waiters: number
}

const cachedPages = new Map<string, { result: ReusableImagesResponse; expiresAt: number }>()
const pendingPages = new Map<string, PendingPage>()

const imageResponse = z.object({
  page_count: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  results: z.array(z.unknown()).max(pageSize),
})
const imageRecord = z.object({
  id: z.uuid(),
  title: z.unknown().optional(),
  url: z.string(),
  foreign_landing_url: z.string(),
  license: z.enum(licenseCodes),
  license_url: z.string(),
  license_version: z.unknown().optional(),
  creator: z.unknown().optional(),
  creator_url: z.unknown().optional(),
  attribution: z.unknown().optional(),
  source: z.unknown().optional(),
  category: z.unknown().optional(),
  width: z.unknown().optional(),
  height: z.unknown().optional(),
})
const imageCategory = z.enum(imageCategories)
const dimension = z.number().int().min(1).max(100_000)
const licenseVersion = /^\d{1,2}\.\d{1,2}$/

function publicUrl(value: unknown): URL | undefined {
  const normalized = resultUrl(value)
  if (!normalized) return
  const url = new URL(normalized)
  if (!url.port && isSearchFaviconHost(url.hostname)) return url
}

function openverseLicense(row: z.infer<typeof imageRecord>): ReusableImage['license'] | undefined {
  const source = publicUrl(row.license_url)
  if (source?.hostname !== 'creativecommons.org') return
  const [, family, name, version] = source.pathname.split('/')
  const code = row.license
  const expectedFamily = code === 'cc0' || code === 'pdm' ? 'publicdomain' : 'licenses'
  const expectedName = code === 'cc0' ? 'zero' : code === 'pdm' ? 'mark' : code
  if (family !== expectedFamily || name !== expectedName || !version || !licenseVersion.test(version)
    || (row.license_version != null && row.license_version !== '' && row.license_version !== version)) return
  source.protocol = 'https:'
  source.search = ''
  source.hash = ''
  return { code, version, url: source.href }
}

function cleanText(value: unknown, limit: number) {
  return resultText(value, limit * 2).replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim().slice(0, limit) || undefined
}

function normalizeImage(value: unknown, input: ReusableImagesInput): ReusableImage | undefined {
  const parsed = imageRecord.safeParse(value)
  if (!parsed.success) return
  const row = parsed.data
  const sourceUrl = publicUrl(row.foreign_landing_url)
  const imageUrl = publicUrl(row.url)
  const license = openverseLicense(row)
  const category = imageCategory.safeParse(row.category).data
  if (!sourceUrl || !imageUrl || !license
    || (input.license && !licenseGroups[input.license].includes(license.code))
    || (input.category && category !== input.category)) return
  return {
    id: row.id,
    title: cleanText(row.title, 240) ?? 'Untitled image',
    imageUrl: imageUrl.href,
    thumbnailUrl: new URL(row.id + '/thumb/', openverseImagesEndpoint).href,
    sourceUrl: sourceUrl.href,
    license,
    creator: cleanText(row.creator, 160),
    creatorUrl: publicUrl(row.creator_url)?.href,
    attribution: cleanText(row.attribution, 800),
    source: cleanText(row.source, 80),
    category,
    width: dimension.safeParse(row.width).data,
    height: dimension.safeParse(row.height).data,
  }
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value || value.length > 50) return
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000)
  if (Number.isSafeInteger(seconds)) return Math.max(1, seconds)
}

async function readOpenverseJson(response: Response): Promise<unknown> {
  const body = response.body
  if (!response.ok) {
    await body?.cancel().catch(() => {})
    if (response.status === 429) throw new ReusableImagesRateLimitError(retryAfterSeconds(response.headers.get('retry-after')))
    throw new ReusableImagesProviderError('http', response.status)
  }
  if (!body) throw new ReusableImagesProviderError('invalid-response')
  if (Number(response.headers.get('content-length')) > maximumResponseBytes) {
    await body.cancel().catch(() => {})
    throw new ReusableImagesProviderError('body-limit')
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumResponseBytes) throw new ReusableImagesProviderError('body-limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
  } catch {
    throw new ReusableImagesProviderError('invalid-response')
  }
}

async function requestPage(url: URL, filters: ReusableImagesInput, page: number, signal: AbortSignal): Promise<ReusableImagesResponse> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = AbortSignal.any([signal, timeout])
  let payload: unknown
  try {
    requestSignal.throwIfAborted()
    const response = await fetch(url, {
      redirect: 'error', signal: requestSignal, headers: { accept: 'application/json' },
    })
    payload = await readOpenverseJson(response)
    requestSignal.throwIfAborted()
  } catch (error) {
    signal.throwIfAborted()
    if (timeout.aborted) throw new ReusableImagesProviderError('timeout')
    if (error instanceof ReusableImagesProviderError || error instanceof ReusableImagesRateLimitError) throw error
    throw new ReusableImagesProviderError('network')
  }
  const parsed = imageResponse.safeParse(payload)
  if (!parsed.success || parsed.data.page !== page) throw new ReusableImagesProviderError('invalid-response')
  const seen = new Set<string>()
  const results = parsed.data.results.flatMap(value => {
    const image = normalizeImage(value, filters)
    if (!image || seen.has(image.id)) return []
    seen.add(image.id)
    return [image]
  })
  return { provider: 'openverse', page, hasMore: page < Math.min(parsed.data.page_count, maximumPage), results }
}

function cachePage(key: string, result: ReusableImagesResponse) {
  if (cachedPages.size >= maximumCachedPages) {
    const oldest = cachedPages.keys().next()
    if (!oldest.done) cachedPages.delete(oldest.value)
  }
  cachedPages.set(key, { result, expiresAt: Date.now() + cacheTtlMs })
  setTimeout(() => {
    const entry = cachedPages.get(key)
    if (entry && entry.expiresAt <= Date.now()) cachedPages.delete(key)
  }, cacheTtlMs).unref()
}

export async function searchReusableImages(input: ReusableImagesInput, signal?: AbortSignal): Promise<ReusableImagesResponse> {
  signal?.throwIfAborted()
  const filters = reusableImagesInput.parse(input)
  const page = filters.page ?? 1
  const url = new URL(openverseImagesEndpoint)
  url.search = new URLSearchParams({
    q: filters.query,
    page: String(page),
    page_size: String(pageSize),
    mature: 'false',
    ...(filters.license ? { license: licenseGroups[filters.license].join(',') } : {}),
    ...(filters.category ? { category: filters.category } : {}),
  }).toString()

  const key = createHash('sha256').update(url.href).digest('hex')
  const cached = cachedPages.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  cachedPages.delete(key)

  let pending = pendingPages.get(key)
  if (!pending) {
    const controller = new AbortController()
    const entry: PendingPage = {
      controller,
      waiters: 0,
      result: requestPage(url, filters, page, controller.signal).then(result => {
        if (!controller.signal.aborted && result.results.length > 0) cachePage(key, result)
        return result
      }).finally(() => {
        if (pendingPages.get(key) === entry) pendingPages.delete(key)
      }),
    }
    pendingPages.set(key, entry)
    pending = entry
  }

  pending.waiters += 1
  let subscription: ReturnType<typeof addAbortListener> | undefined
  try {
    const cancelled = signal && new Promise<never>((_resolve, reject) => {
      subscription = addAbortListener(signal, () => reject(signal.reason))
    })
    const result = cancelled ? await Promise.race([pending.result, cancelled]) : await pending.result
    signal?.throwIfAborted()
    return result
  } finally {
    subscription?.[Symbol.dispose]()
    pending.waiters -= 1
    // An abandoned response should stop using time and upstream connections.
    if (pending.waiters === 0 && pendingPages.get(key) === pending) {
      pendingPages.delete(key)
      pending.controller.abort()
    }
  }
}
