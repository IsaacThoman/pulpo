import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { AppError, unauthorized } from '../lib/errors.js'
import { createCurrencyLookup, parseEcbRates, registerSearchCurrencyRoute } from './currency.js'

const friday = '2026-11-20'
const saturday = Date.parse('2026-11-21T12:00:00Z')
const source = {
  name: 'European Central Bank',
  url: expect.stringContaining('www.ecb.europa.eu/'),
  description: expect.stringContaining('Indicative conversion by Pulpo from freely available'),
}
const feed = (date = friday, usd = '1.2', jpy = '180') => [
  '<gesmes:Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">',
  '<Cube><Cube time="' + date + '">',
  "<Cube currency='USD' rate='" + usd + "'/>",
  '<Cube currency="JPY" rate="' + jpy + '"/>',
  "<Cube currency='IDR' rate='20000'/>",
  '</Cube></Cube></gesmes:Envelope>',
].join('\n')

describe('ECB Search currency conversion', () => {
  it('uses base and cross rates, currency precision, and the dated reference source', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(feed()))
    const lookup = createCurrencyLookup(fetcher, () => saturday)
    const [toEuro, cross, toUsd, tiny, fractional] = await Promise.all([
      lookup({ amount: '100', from: 'USD', to: 'EUR' }),
      lookup({ amount: '2.5', from: 'USD', to: 'JPY' }),
      lookup({ amount: '-1.025', from: 'EUR', to: 'USD' }),
      lookup({ amount: '1', from: 'IDR', to: 'EUR' }),
      lookup({ amount: '0.000001', from: 'IDR', to: 'EUR' }),
    ])
    expect(toEuro).toMatchObject({ status: 'converted', converted: '83.33', rate: '0.83333333', referenceDate: friday, source })
    expect(cross).toMatchObject({ status: 'converted', converted: '375', rate: '150', referenceDate: friday })
    // 1.025 EUR × 1.2 = 1.23 USD exactly.
    expect(toUsd).toMatchObject({ status: 'converted', converted: '-1.23', rate: '1.2' })
    expect(tiny).toMatchObject({ status: 'converted', converted: '0.00005', rate: '0.00005' })
    expect(fractional).toMatchObject({ status: 'converted', converted: '0.00000000005' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    )
  })

  it('rounds exact halfway values away from zero', async () => {
    const lookup = createCurrencyLookup(async () => new Response(feed(friday, '1.005')), () => saturday)
    await expect(lookup({ amount: '1', from: 'EUR', to: 'USD' })).resolves.toMatchObject({ converted: '1.01' })
    await expect(lookup({ amount: '-1', from: 'EUR', to: 'USD' })).resolves.toMatchObject({ converted: '-1.01' })
  })

  it('keeps a bounded dated reference snapshot through temporary outages', async () => {
    let now = saturday
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(feed()))
      .mockImplementation(async () => new Response(null, { status: 503 }))
    const lookup = createCurrencyLookup(fetcher, () => now)
    const query = { amount: '100', from: 'EUR', to: 'USD' }
    await expect(lookup(query)).resolves.toMatchObject({ status: 'converted', referenceDate: friday })
    now += 31 * 60_000
    await expect(lookup(query)).resolves.toMatchObject({ status: 'converted', referenceDate: friday })
    await expect(lookup(query)).resolves.toMatchObject({ status: 'converted', referenceDate: friday })
    expect(fetcher).toHaveBeenCalledTimes(2)
    now += 7 * 86_400_000
    await expect(lookup(query)).resolves.toMatchObject({ status: 'unavailable', source })
  })

  it('updates the result only after an accepted newer publication', async () => {
    let now = saturday
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(feed()))
      .mockResolvedValueOnce(new Response(feed('2026-11-23', '1.3')))
      .mockResolvedValueOnce(new Response(feed('2026-11-19', '1.1')))
    const lookup = createCurrencyLookup(fetcher, () => now)
    const query = { amount: '100', from: 'EUR', to: 'USD' }
    await expect(lookup(query)).resolves.toMatchObject({ status: 'converted', converted: '120', referenceDate: friday })
    now = Date.parse('2026-11-23T16:00:00Z')
    await expect(lookup(query)).resolves.toMatchObject({ status: 'converted', converted: '130', referenceDate: '2026-11-23' })
    now += 31 * 60_000
    await expect(lookup(query)).resolves.toMatchObject({ status: 'converted', converted: '130', referenceDate: '2026-11-23' })
  })

  it('rejects invalid or oversized upstream payloads and identifies an unavailable currency', async () => {
    expect(parseEcbRates(feed('2026-02-29'))).toBeUndefined()
    expect(parseEcbRates(feed(friday, '0'))).toBeUndefined()
    expect(parseEcbRates(feed().replace('JPY', 'USD'))).toBeUndefined()
    expect(parseEcbRates(feed().replace('ecb.int', 'example.com'))).toBeUndefined()
    const lookup = createCurrencyLookup(async () => new Response(feed()), () => saturday)
    await expect(lookup({ amount: '1', from: 'EUR', to: 'BTC' })).resolves.toMatchObject({ status: 'unsupported', currency: 'BTC', source })
    const large = createCurrencyLookup(async () => new Response(feed() + ' '.repeat(16_384)), () => saturday)
    await expect(large({ amount: '1', from: 'EUR', to: 'USD' })).resolves.toMatchObject({ status: 'unavailable', source })
  })

  it('checks Search session and body before entering the shared rate lookup', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(feed()))
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      reply.code(error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500).send()
    })
    registerSearchCurrencyRoute(app, (request, reply) => {
      if (request.headers.authorization !== 'Bearer test-session') throw unauthorized()
      reply.header('cache-control', 'no-store')
    }, createCurrencyLookup(fetcher, () => saturday))
    const url = '/api/search/currency'
    const body = { amount: '100', from: 'usd', to: 'eur' }
    const headers = { authorization: 'Bearer test-session' }
    try {
      expect((await app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url, headers, payload: { ...body, amount: '1e6' } })).statusCode).toBe(400)
      expect(fetcher).not.toHaveBeenCalled()
      const response = await app.inject({ method: 'POST', url, headers, payload: body })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toMatchObject({ status: 'converted', from: 'USD', to: 'EUR', converted: '83.33', referenceDate: friday })
    } finally {
      await app.close()
    }
  })
})
