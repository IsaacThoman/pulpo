import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

const feedUrl = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
const source = {
  name: 'European Central Bank',
  url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
  description: 'Indicative conversion by Pulpo from freely available ECB daily reference rates.',
}
const maximumFeedBytes = 16_384
const freshnessMs = 30 * 60_000
const retryMs = 2 * 60_000
const maximumReferenceAgeMs = 7 * 86_400_000

const code = z.string().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase())
const currencyInput = z.object({
  amount: z.string().regex(/^[+-]?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/),
  from: code,
  to: code,
}).strict()
type CurrencyInput = z.infer<typeof currencyInput>

interface Decimal {
  numerator: bigint
  denominator: bigint
}

interface RateSnapshot {
  referenceDate: string
  publishedDay: number
  rates: Map<string, Decimal>
}

function decimal(value: string): Decimal {
  const [whole, fraction = ''] = value.split('.')
  return {
    numerator: BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length),
  }
}

export function parseEcbRates(text: string): RateSnapshot | undefined {
  if (text.length > maximumFeedBytes || !text.includes('http://www.ecb.int/vocabulary/2002-08-01/eurofxref')) return
  // The ECB daily feed has a single dated Cube of currency/rate pairs.
  const cubes = [...text.matchAll(/<Cube\s+time=(['"])(\d{4}-\d{2}-\d{2})\1\s*>([\s\S]*?)<\/Cube>/g)]
  if (cubes.length !== 1) return
  const [, , referenceDate, entries] = cubes[0]!
  if (!referenceDate || !entries) return
  const publishedDay = Date.parse(referenceDate + 'T00:00:00Z')
  if (!Number.isFinite(publishedDay) || new Date(publishedDay).toISOString().slice(0, 10) !== referenceDate) return
  const rates = new Map<string, Decimal>([['EUR', decimal('1')]])
  const row = /<Cube\s+currency=(['"])([A-Z]{3})\1\s+rate=(['"])(\d{1,8}(?:\.\d{1,8})?)\3\s*\/>/g
  if (entries.replace(row, '').trim()) return
  for (const [, , isoCode, , value] of entries.matchAll(row)) {
    const rate = decimal(value!)
    if (rates.has(isoCode!) || rate.numerator <= 0) return
    rates.set(isoCode!, rate)
  }
  if (rates.size < 2) return
  return { referenceDate, publishedDay, rates }
}

async function fetchEcbRates(fetcher: typeof fetch) {
  const response = await fetcher(feedUrl, {
    headers: { accept: 'application/xml, text/xml' },
    redirect: 'error',
    signal: AbortSignal.timeout(3_500),
  })
  const body = response.body
  if (!response.ok || !body || Number(response.headers.get('content-length')) > maximumFeedBytes) {
    await body?.cancel().catch(() => {})
    return
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return parseEcbRates(text + decoder.decode())
      bytes += value.byteLength
      if (bytes > maximumFeedBytes) return
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function roundedDecimal(numerator: bigint, denominator: bigint, places: number) {
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const scaled = (2n * magnitude * 10n ** BigInt(places) + denominator) / (2n * denominator)
  if (scaled === 0n) return '0'
  const sign = negative ? '-' : ''
  if (places === 0) return sign + scaled.toString()
  const digits = scaled.toString().padStart(places + 1, '0')
  const fraction = digits.slice(-places).replace(/0+$/, '')
  return sign + digits.slice(0, -places) + (fraction ? '.' + fraction : '')
}

export function createCurrencyLookup(fetcher: typeof fetch = globalThis.fetch, clock = Date.now) {
  let snapshot: RateSnapshot | undefined
  let refreshAt = 0
  let pending: Promise<void> | undefined

  return async ({ amount, from, to }: CurrencyInput) => {
    const now = clock()
    if (now >= refreshAt) {
      pending ??= fetchEcbRates(fetcher).then(next => {
        const elapsed = clock() - (next?.publishedDay ?? -Infinity)
        if (!next || elapsed < 0 || elapsed > maximumReferenceAgeMs || (snapshot && next.publishedDay < snapshot.publishedDay)) {
          refreshAt = clock() + retryMs
          return
        }
        snapshot = next
        refreshAt = clock() + freshnessMs
      }).catch(() => {
        refreshAt = clock() + retryMs
      }).finally(() => { pending = undefined })
      await pending
    }
    const referenceAge = clock() - (snapshot?.publishedDay ?? -Infinity)
    if (!snapshot || referenceAge < 0 || referenceAge > maximumReferenceAgeMs) return { status: 'unavailable' as const, source }
    const fromRate = snapshot.rates.get(from)
    const toRate = snapshot.rates.get(to)
    if (!fromRate) return { status: 'unsupported' as const, currency: from, source }
    if (!toRate) return { status: 'unsupported' as const, currency: to, source }
    const rateNumerator = toRate.numerator * fromRate.denominator
    const rateDenominator = toRate.denominator * fromRate.numerator
    const amountValue = decimal(amount)
    const numerator = amountValue.numerator * rateNumerator
    const denominator = amountValue.denominator * rateDenominator
    const places = new Intl.NumberFormat('en', { style: 'currency', currency: to }).resolvedOptions().maximumFractionDigits ?? 2
    const rounded = roundedDecimal(numerator, denominator, places)
    return {
      status: 'converted' as const,
      amount, from, to,
      converted: rounded === '0' && numerator !== 0n ? roundedDecimal(numerator, denominator, 12) : rounded,
      rate: roundedDecimal(rateNumerator, rateDenominator, 8),
      referenceDate: snapshot.referenceDate,
      source,
    }
  }
}

const lookupCurrency = createCurrencyLookup((...args) => globalThis.fetch(...args))

export function registerSearchCurrencyRoute(
  app: FastifyInstance,
  authorize: (request: FastifyRequest, reply: FastifyReply) => unknown,
  lookup = lookupCurrency,
) {
  app.post('/api/search/currency', {
    bodyLimit: 256,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    authorize(request, reply)
    return lookup(currencyInput.parse(request.body))
  })
}
