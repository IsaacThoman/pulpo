import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { webToolProviderSchema, type WebToolProvider } from '@pulpo/contracts'
import { releaseMeteredBudget, reserveMeteredBudget, settleMeteredBudget } from '../accounting/service.js'
import { KAGI_MAX_SEARCH_PAGE } from '../agent/kagi.js'
import { basicSearchCategories, searchCategories, type ProviderSearchInput, type SearchCategory, type SearchResults } from '../agent/search-results.js'
import { availableWebSearchProviders, billedPrice, createWebProviderClients } from '../agent/web-tools.js'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseWebToolsSettings } from '../settings/application-settings.js'
import { registerSearchCurrencyRoute } from './currency.js'
import { fetchSearchFavicon } from './favicon.js'
import { filterSearchHosts, searchHostFilters, searchScopes } from './scope.js'
import { registerSearchWeatherRoute } from './weather/routes.js'

const providerCapabilities: Record<WebToolProvider, { categories: readonly SearchCategory[]; maxPage: number }> = {
  kagi: { categories: searchCategories, maxPage: KAGI_MAX_SEARCH_PAGE },
  firecrawl: { categories: basicSearchCategories, maxPage: 1 },
}
const dates = ['day', 'week', 'month', 'year'] as const
const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  providers: z.array(webToolProviderSchema).min(1).max(2)
    .refine((providers) => new Set(providers).size === providers.length, 'Choose different primary and fallback providers')
    .optional(),
  limit: z.number().int().min(1).max(20).default(10),
  page: z.number().int().min(1).max(KAGI_MAX_SEARCH_PAGE).default(1),
  category: z.enum(searchCategories).default('web'),
  scope: z.enum(searchScopes).optional(),
  region: z.string().regex(/^[a-z]{2}$/i, 'Choose a two-letter country code').toUpperCase().optional(),
  date: z.enum(dates).optional(),
}).strict().refine(input => !input.scope || input.category === 'web', {
  path: ['scope'], message: 'Search focus applies to web results',
})

async function readSearchSettings() {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'webTools')).limit(1)
  return parseWebToolsSettings(row?.value)
}

function searchOrigin() {
  const origin = getConfig().SEARCH_PUBLIC_URL
  if (!origin) throw new AppError(404, 'search_disabled', 'Pulpo Search is unavailable')
  return origin
}

function searchUser(request: FastifyRequest, reply: FastifyReply) {
  reply.header('cache-control', 'no-store')
  searchOrigin()
  return requireUser(request)
}

export function registerSearchRoutes(app: FastifyInstance) {
  registerSearchCurrencyRoute(app, searchUser)
  registerSearchWeatherRoute(app, searchUser)

  app.get<{ Params: { host: string } }>('/api/search/favicon/:host', {
    config: { rateLimit: { max: 160, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    searchUser(request, reply)
    const icon = await fetchSearchFavicon(request.params.host)
    reply.header('cache-control', icon ? 'private, max-age=86400' : 'private, max-age=300')
    if (!icon) return reply.code(404).send()
    return reply.type(icon.type).send(icon.data)
  })

  app.get('/api/search/opensearch.xml', (_request, reply) => {
    const searchUrl = new URL('/search', searchOrigin()).href
    return reply.type('application/opensearchdescription+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Pulpo Search</ShortName>
  <Description>Search the web with Pulpo.</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Url type="text/html" template="${searchUrl}?q={searchTerms}"/>
</OpenSearchDescription>`)
  })

  app.get('/api/search/config', async (request, reply) => {
    searchUser(request, reply)
    const settings = await readSearchSettings()
    const defaultOrder = availableWebSearchProviders(settings)
    return {
      defaultOrder,
      currency: true,
      weather: true,
      providers: defaultOrder.map((id) => ({
        id, ...providerCapabilities[id], dates, region: true, priceMicros: billedPrice(id, 'search', settings),
      })),
    }
  })

  app.post('/api/search/query', { bodyLimit: 4096, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = searchUser(request, reply)
    const input = searchInputSchema.parse(request.body)
    const filters = searchHostFilters(input.query, input.scope)
    if (filters.includeDomains.length > 20 || filters.excludeDomains.length > 20) {
      throw new AppError(400, 'too_many_search_domains', 'Use up to 20 included and 20 excluded sites.')
    }
    const settings = await readSearchSettings()
    const available = availableWebSearchProviders(settings)
    const selected = input.providers?.filter((provider) => available.includes(provider)) ?? available
    if (!selected.length) throw new AppError(503, 'search_provider_unavailable', 'No selected search provider is available', 'server_error')
    const providers = selected.filter((provider) => {
      const capabilities = providerCapabilities[provider]
      return capabilities.categories.includes(input.category) && input.page <= capabilities.maxPage
    })
    if (!providers.length) throw new AppError(400, 'search_not_supported', 'No selected provider supports this search type or page')
    if (filters.matchesNothing) return { provider: providers[0], results: [] }

    const clients = createWebProviderClients(settings, getConfig().ENCRYPTION_KEY)
    const providerInput: ProviderSearchInput = {
      query: filters.query, limit: input.limit, page: input.page, category: input.category, region: input.region, timeRelative: input.date,
      ...(filters.includeDomains.length ? { includeDomains: filters.includeDomains } : {}),
      ...(filters.excludeDomains.length ? { excludeDomains: filters.excludeDomains } : {}),
    }
    const controller = new AbortController()
    const onClose = () => {
      if (!reply.raw.writableFinished) controller.abort()
    }
    reply.raw.on('close', onClose)
    let empty: (SearchResults & { provider: WebToolProvider }) | undefined
    let budgetError: AppError | undefined
    try {
      for (const provider of providers) {
        controller.signal.throwIfAborted()
        const costMicros = billedPrice(provider, 'search', settings)
        let reservationId: string | undefined
        if (costMicros > 0) {
          try {
            reservationId = await reserveMeteredBudget({ userId: user.id, costMicros })
          } catch (error) {
            if (!(error instanceof AppError) || error.statusCode !== 402) throw error
            budgetError ??= error
            continue
          }
        }

        let settled = false
        try {
          let result: SearchResults
          try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
            signal.throwIfAborted()
            result = filterSearchHosts(await clients[provider]!.searchResults(providerInput, signal), filters)
            signal.throwIfAborted()
          } catch {
            controller.signal.throwIfAborted()
            request.log.warn({ provider }, 'Search provider failed')
            continue
          }
          if (!result.results.length && !result.answer && !result.knowledge) {
            empty ??= { provider, ...result }
            continue
          }
          if (reservationId) {
            await settleMeteredBudget({
              reservationId, costMicros, type: 'web_search',
              metadata: { provider, category: input.category, resultCount: result.results.length },
            })
            settled = true
          }
          return { provider, ...result }
        } finally {
          if (reservationId && !settled) {
            await releaseMeteredBudget(reservationId).catch(() => {
              request.log.warn({ provider, reservationId }, 'Search reservation cleanup failed')
            })
          }
        }
      }
      if (empty) return empty
      if (budgetError) throw budgetError
      throw new AppError(502, 'search_failed', 'Search is temporarily unavailable. Try again.', 'server_error')
    } catch (error) {
      if (controller.signal.aborted) throw new AppError(408, 'search_cancelled', 'Search was cancelled')
      throw error
    } finally {
      reply.raw.off('close', onClose)
    }
  })
}
