import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { webToolProviderSchema, type SearchRequestOutcome, type WebToolProvider } from '@pulpo/contracts'
import { searchDateRange, type SearchDegraded } from '@pulpo/contracts/search'
import { releaseMeteredBudget, reserveMeteredBudget, settleMeteredBudget } from '../accounting/service.js'
import { FIRECRAWL_DEFAULT_API_BASE } from '../agent/firecrawl.js'
import { KAGI_IMAGE_RESULT_LIMIT, KAGI_MAX_SEARCH_PAGE, KAGI_RESULT_LIMIT } from '../agent/kagi.js'
import { basicSearchCategories, searchCategories, type ProviderSearchInput, type SearchCategory, type SearchResults } from '../agent/search-results.js'
import { availableWebSearchProviders, billedPrice, createWebProviderClients } from '../agent/web-tools.js'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { decryptSecret } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import type { StoredWebToolsSettings } from '../settings/application-settings.js'
import { registerSearchAccountRoute } from './account.js'
import { registerSearchCurrencyRoute } from './currency.js'
import { fetchSearchFavicon } from './favicon.js'
import { placesCapability, placeSearchInput, searchFirecrawlPlaces, searchPlaces } from './places.js'
import { quickAnswerInput, quickAnswerParams } from './quick-answer-policy.js'
import { cancelQuickAnswer, quickAnswerCapability, startQuickAnswer, streamQuickAnswer } from './quick-answer.js'
import { ReusableImagesProviderError, ReusableImagesRateLimitError, reusableImagesInput, searchReusableImages } from './reusable-images.js'
import { createProviderHealth } from './provider-health.js'
import { filterSearchHosts, searchHostFilters, searchScopes } from './scope.js'
import { readSearchSettings } from './settings.js'
import { isTimeoutError, recordSearchRequest, SearchTimer } from './timing.js'
import { registerSearchWeatherRoute } from './weather/routes.js'

const providerCapabilities: Record<WebToolProvider, { categories: readonly SearchCategory[]; maxPage: number; expandedImages?: true }> = {
  kagi: { categories: searchCategories, maxPage: KAGI_MAX_SEARCH_PAGE, expandedImages: true },
  firecrawl: { categories: basicSearchCategories, maxPage: 1 },
}
const dates = ['day', 'week', 'month', 'year'] as const
const customDateRanges: readonly SearchCategory[] = ['web', 'news']
const dateRangeSchema = z.strictObject({ from: z.string().length(10), to: z.string().length(10) })
  .refine(range => Boolean(searchDateRange(range.from, range.to)), 'Choose valid dates with the start on or before the end.')
const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  providers: z.array(webToolProviderSchema).min(1).max(2)
    .refine((providers) => new Set(providers).size === providers.length, 'Choose different primary and fallback providers')
    .optional(),
  limit: z.number().int().min(1).max(KAGI_RESULT_LIMIT).default(KAGI_RESULT_LIMIT),
  expandedImages: z.literal(true).optional(),
  page: z.number().int().min(1).max(KAGI_MAX_SEARCH_PAGE).default(1),
  category: z.enum(searchCategories).default('web'),
  scope: z.enum(searchScopes).optional(),
  region: z.string().regex(/^[a-z]{2}$/i, 'Choose a two-letter country code').toUpperCase().optional(),
  safeSearch: z.boolean().optional(),
  date: z.enum(dates).optional(),
  dateRange: dateRangeSchema.optional(),
}).strict().refine(input => !input.scope || input.category === 'web', {
  path: ['scope'], message: 'Search focus applies to web results',
}).refine(input => !input.date || !input.dateRange, {
  path: ['dateRange'], message: 'Choose a preset or a custom date range.',
}).refine(input => !input.dateRange || customDateRanges.includes(input.category), {
  path: ['dateRange'], message: 'Custom dates are available for Web and News.',
}).refine(input => !input.expandedImages || input.category === 'images', {
  path: ['expandedImages'], message: 'An expanded gallery requires an image search.',
})

function hasResults(result: SearchResults) {
  return Boolean(result.results.length || result.answer || result.knowledge || result.podcastShows?.length)
}

const isFilter = (value: unknown): value is string => typeof value === 'string'

/** Which options shaped a search, recorded in place of the query text. */
function queryFilters(input: z.infer<typeof searchInputSchema>, sites: boolean): string[] {
  return [
    input.scope && 'scope', sites && 'sites', input.region && 'region', input.date && 'date', input.dateRange && 'date_range',
    input.safeSearch === false && 'safe_search_off', input.providers && 'providers', input.expandedImages && 'expanded_images',
  ].filter(isFilter)
}

/**
 * How long one provider call may take. With a fallback left, give up near the
 * provider's usual slow tail (prod p90: Kagi 2.1 s, Firecrawl 5.7 s) so the next
 * one still has time; the last provider gets longer, since nothing else can answer.
 * Publisher metadata scrapes each article, so it gets more in both cases.
 */
function providerDeadlineMs(provider: WebToolProvider, last: boolean, publisherMetadata: boolean): number {
  if (publisherMetadata) return last ? 15_000 : 10_000
  return last ? 12_000 : { kagi: 4_500, firecrawl: 7_000 }[provider]
}

function defaultNewsOrder(providers: WebToolProvider[]): WebToolProvider[] {
  // Firecrawl supplies article descriptions and thumbnails with its news results.
  return providers.includes('firecrawl') ? ['firecrawl', ...providers.filter(provider => provider !== 'firecrawl')] : providers
}

function firecrawlNewsPrice(settings: StoredWebToolsSettings) {
  if (settings.firecrawl.baseUrl.replace(/\/+$/, '') === FIRECRAWL_DEFAULT_API_BASE && settings.encryptedFirecrawlApiKey) {
    return getConfig().SEARCH_FIRECRAWL_NEWS_PRICE_MICROS
  }
}

async function configuredPlaces(settings?: StoredWebToolsSettings) {
  const { SEARCH_FIRECRAWL_PLACES_PRICE_MICROS: priceMicros, SEARCH_BRAVE_PLACES_API_KEY: braveApiKey } = getConfig()
  if (priceMicros !== undefined) {
    const webTools = settings ?? await readSearchSettings()
    if (webTools.firecrawl.baseUrl.replace(/\/+$/, '') === FIRECRAWL_DEFAULT_API_BASE && webTools.encryptedFirecrawlApiKey) {
      return { provider: 'firecrawl' as const, priceMicros, encryptedApiKey: webTools.encryptedFirecrawlApiKey }
    }
    return
  }
  if (braveApiKey) return { ...placesCapability, apiKey: braveApiKey }
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
  let openverseRetryAt = 0
  const providerHealth = createProviderHealth()
  registerSearchAccountRoute(app, searchUser)
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
    const user = searchUser(request, reply)
    const [settings, quickAnswer] = await Promise.all([readSearchSettings(), quickAnswerCapability(user.id)])
    const defaultOrder = availableWebSearchProviders(settings)
    const places = await configuredPlaces(settings)
    const newsPriceMicros = defaultOrder.includes('firecrawl') ? firecrawlNewsPrice(settings) : undefined
    return {
      defaultOrder,
      newsDefaultOrder: defaultNewsOrder(defaultOrder),
      currency: true,
      weather: true,
      ...(places ? { places: { provider: places.provider, priceMicros: places.priceMicros } } : {}),
      ...(quickAnswer ? { quickAnswer } : {}),
      ...(getConfig().SEARCH_OPENVERSE_ENABLED ? { reusableImages: true } : {}),
      providers: defaultOrder.map((id) => ({
        id, ...providerCapabilities[id], dates, customDateRanges, region: true, priceMicros: billedPrice(id, 'search', settings),
        ...(id === 'firecrawl' && newsPriceMicros ? { newsPriceMicros } : {}),
      })),
    }
  })

  app.post('/api/search/reusable-images', {
    bodyLimit: 2048,
    config: { rateLimit: {
      max: 16, timeWindow: '1 minute', hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) => request.user ? 'openverse' : request.ip,
    } },
  }, async (request, reply) => {
    searchUser(request, reply)
    if (!getConfig().SEARCH_OPENVERSE_ENABLED) {
      throw new AppError(404, 'reusable_images_disabled', 'Reusable images are unavailable')
    }
    const input = reusableImagesInput.parse(request.body)
    const retryAfter = Math.ceil((openverseRetryAt - Date.now()) / 1000)
    if (retryAfter > 0) {
      reply.header('retry-after', String(retryAfter))
      throw new AppError(429, 'reusable_images_rate_limit', 'Openverse reached its search limit. Try again later.', 'rate_limit_error')
    }
    const controller = new AbortController()
    const onClose = () => { if (!reply.raw.writableFinished) controller.abort() }
    reply.raw.on('close', onClose)
    if (reply.raw.destroyed) controller.abort()
    try {
      return await searchReusableImages(input, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) throw new AppError(408, 'search_cancelled', 'Search was cancelled')
      if (error instanceof ReusableImagesRateLimitError) {
        const seconds = Math.min(error.retryAfterSeconds ?? 60, 86_400)
        openverseRetryAt = Math.max(openverseRetryAt, Date.now() + seconds * 1000)
        reply.header('retry-after', String(seconds))
        throw new AppError(429, 'reusable_images_rate_limit', 'Openverse reached its search limit. Try again later.', 'rate_limit_error')
      }
      if (error instanceof ReusableImagesProviderError) {
        request.log.warn({ category: error.category, upstreamStatus: error.status }, 'Openverse lookup failed')
        if (error.category === 'timeout' || error.status === 504) {
          throw new AppError(504, 'reusable_images_timeout', 'Openverse took too long to respond. Try again or switch to All images.', 'server_error')
        }
      }
      throw new AppError(502, 'reusable_images_unavailable', 'Openverse is temporarily unavailable. Try again.', 'server_error')
    } finally {
      reply.raw.off('close', onClose)
    }
  })

  app.post('/api/search/quick-answer', {
    bodyLimit: 4096,
    config: { rateLimit: {
      max: 6, timeWindow: '1 minute', hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
    } },
  }, async (request, reply) => {
    const user = searchUser(request, reply)
    const input = quickAnswerInput.parse(request.body)
    const result = await startQuickAnswer(user.id, input, request.requestReceivedAt)
    return reply.code(202).send(result)
  })

  app.get('/api/search/quick-answer/:responseId/events', {
    config: { rateLimit: {
      max: 12, timeWindow: '1 minute', hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
    } },
  }, async (request, reply) => {
    const user = searchUser(request, reply)
    const { responseId } = quickAnswerParams.parse(request.params)
    return streamQuickAnswer(reply, user.id, responseId)
  })

  app.post('/api/search/quick-answer/:responseId/cancel', {
    config: { rateLimit: {
      max: 12, timeWindow: '1 minute', hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
    } },
  }, async (request, reply) => {
    const user = searchUser(request, reply)
    const { responseId } = quickAnswerParams.parse(request.params)
    await cancelQuickAnswer(user.id, responseId)
    return reply.code(204).send()
  })

  app.post('/api/search/places', {
    bodyLimit: 4096,
    config: { rateLimit: {
      max: 12, timeWindow: '1 minute', hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
    } },
  }, async (request, reply) => {
    const timer = new SearchTimer(request.requestReceivedAt)
    const user = searchUser(request, reply)
    const places = await timer.time('settingsMs', () => configuredPlaces())
    if (!places) throw new AppError(404, 'places_disabled', 'Place search is unavailable')
    const input = placeSearchInput.parse(request.body)
    const { provider, priceMicros: costMicros } = places
    const controller = new AbortController()
    const onClose = () => { if (!reply.raw.writableFinished) controller.abort() }
    reply.raw.on('close', onClose)
    const outcome: { outcome: SearchRequestOutcome; provider?: string; resultCount?: number } = { outcome: 'error' }
    let reservationId: string | undefined
    let settled = false
    try {
      try {
        reservationId = await timer.time('reserveMs', () => reserveMeteredBudget({ userId: user.id, costMicros }))
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 402) {
          outcome.outcome = 'budget'
          timer.attempt(provider)('skipped_budget')
        }
        throw error
      }
      let result
      const finish = timer.attempt(provider)
      try {
        result = places.provider === 'firecrawl'
          ? await searchFirecrawlPlaces(input, decryptSecret(places.encryptedApiKey, getConfig().ENCRYPTION_KEY), controller.signal)
          : await searchPlaces(input, places.apiKey, controller.signal)
        controller.signal.throwIfAborted()
        finish(result.results.length ? 'success' : 'empty', result.results.length)
      } catch (error) {
        if (controller.signal.aborted) {
          finish('cancelled')
          outcome.outcome = 'cancelled'
          throw new AppError(408, 'search_cancelled', 'Search was cancelled')
        }
        finish(isTimeoutError(error) ? 'timeout' : 'error')
        request.log.warn({ provider }, 'Place search provider failed')
        throw new AppError(502, 'places_unavailable', 'Place search is temporarily unavailable. Try again.', 'server_error')
      }
      Object.assign(outcome, { outcome: result.results.length ? 'success' : 'empty', provider, resultCount: result.results.length })
      if (result.results.length) {
        await timer.time('settleMs', () => settleMeteredBudget({
          reservationId: reservationId!, costMicros, type: 'web_search',
          metadata: { provider, category: 'places', resultCount: result.results.length },
        }))
        settled = true
      }
      return result
    } finally {
      reply.raw.off('close', onClose)
      if (reservationId && !settled) {
        const held = reservationId
        await timer.time('releaseMs', () => releaseMeteredBudget(held)).catch(() => {
          request.log.warn({ provider, reservationId }, 'Search reservation cleanup failed')
        })
      }
      const durationMs = timer.elapsed()
      reply.header('server-timing', timer.serverTiming(durationMs))
      recordSearchRequest(request.log, {
        userId: user.id, kind: 'places', category: 'places', ...outcome, durationMs, timer,
        queryLength: input.query.length, filters: [input.location && 'location', input.openNow && 'open_now'].filter(isFilter),
      })
    }
  })

  app.post('/api/search/query', { bodyLimit: 4096, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const timer = new SearchTimer(request.requestReceivedAt)
    const user = searchUser(request, reply)
    const input = searchInputSchema.parse(request.body)
    const filters = searchHostFilters(input.query, input.scope)
    if (filters.includeDomains.length > 20 || filters.excludeDomains.length > 20) {
      throw new AppError(400, 'too_many_search_domains', 'Use up to 20 included and 20 excluded sites.')
    }
    const outcome: { outcome: SearchRequestOutcome; provider?: string; resultCount?: number } = { outcome: 'error' }
    const controller = new AbortController()
    const onClose = () => {
      if (!reply.raw.writableFinished) controller.abort()
    }
    try {
      const settings = await timer.time('settingsMs', () => readSearchSettings())
      const available = availableWebSearchProviders(settings)
      const newsPriceMicros = input.category === 'news' ? firecrawlNewsPrice(settings) : undefined
      // A client can hold a provider list from before an admin disabled one; then use today's default order.
      const requested = input.providers?.filter((provider) => available.includes(provider))
      const selected = requested?.length ? requested : input.category === 'news' ? defaultNewsOrder(available) : available
      if (!selected.length) {
        outcome.outcome = 'unavailable'
        throw new AppError(503, 'search_provider_unavailable', 'No selected search provider is available', 'server_error')
      }
      const providers = selected.filter((provider) => {
        const capabilities = providerCapabilities[provider]
        return capabilities.categories.includes(input.category) && input.page <= capabilities.maxPage
      })
      if (!providers.length) {
        outcome.outcome = 'unsupported'
        throw new AppError(400, 'search_not_supported', 'No selected provider supports this search type or page')
      }
      if (filters.matchesNothing) {
        outcome.outcome = 'filtered'
        return { provider: providers[0], results: [] }
      }

      const clients = createWebProviderClients(settings, getConfig().ENCRYPTION_KEY)
      const providerInput: ProviderSearchInput = {
        query: filters.query, limit: input.limit, page: input.page, category: input.category, region: input.region, timeRelative: input.date,
        safeSearch: input.safeSearch ?? true,
        ...(input.dateRange ? { dateRange: input.dateRange } : {}),
        ...(filters.includeDomains.length ? { includeDomains: filters.includeDomains } : {}),
        ...(filters.excludeDomains.length ? { excludeDomains: filters.excludeDomains } : {}),
      }
      reply.raw.on('close', onClose)
      let empty: (SearchResults & { provider: WebToolProvider }) | undefined
      let budgetError: AppError | undefined
      const failed: WebToolProvider[] = []
      for (const [index, provider] of providers.entries()) {
        controller.signal.throwIfAborted()
        const last = index === providers.length - 1
        if (!last && providerHealth.unhealthy(provider)) {
          timer.attempt(provider)('skipped_unhealthy')
          failed.push(provider)
          continue
        }
        const publisherPrice = provider === 'firecrawl' ? newsPriceMicros : undefined
        const costMicros = publisherPrice ?? billedPrice(provider, 'search', settings)
        let reservationId: string | undefined
        if (costMicros > 0) {
          try {
            reservationId = await timer.time('reserveMs', () => reserveMeteredBudget({ userId: user.id, costMicros }))
          } catch (error) {
            if (!(error instanceof AppError) || error.statusCode !== 402) throw error
            timer.attempt(provider)('skipped_budget')
            budgetError ??= error
            continue
          }
        }

        let settled = false
        try {
          let result: SearchResults
          const timeoutMs = providerDeadlineMs(provider, last, Boolean(publisherPrice))
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
          const finish = timer.attempt(provider)
          const startedAt = performance.now()
          try {
            signal.throwIfAborted()
            const limit = provider === 'kagi' && input.expandedImages ? KAGI_IMAGE_RESULT_LIMIT : providerInput.limit
            const requestInput: ProviderSearchInput = { ...providerInput, limit, timeoutMs, ...(publisherPrice ? { includePublisherMetadata: true } : {}) }
            result = filterSearchHosts(await clients[provider]!.searchResults(requestInput, signal), filters)
            signal.throwIfAborted()
            finish(hasResults(result) ? 'success' : 'empty', result.results.length)
            providerHealth.succeeded(provider)
          } catch (error) {
            if (controller.signal.aborted) {
              finish('cancelled')
              throw controller.signal.reason
            }
            // Firecrawl ends its own search just before our deadline, so its error that late is a timeout too.
            const timedOut = isTimeoutError(error, signal) || (provider === 'firecrawl' && performance.now() - startedAt >= timeoutMs - 1_000)
            finish(timedOut ? 'timeout' : 'error')
            providerHealth.failed(provider)
            failed.push(provider)
            request.log.warn({ provider, timedOut }, 'Search provider failed')
            continue
          }
          if (!hasResults(result)) {
            empty ??= { provider, ...result }
            continue
          }
          if (reservationId) {
            const held = reservationId
            await timer.time('settleMs', () => settleMeteredBudget({
              reservationId: held, costMicros, type: 'web_search',
              metadata: { provider, category: input.category, resultCount: result.results.length },
            }))
            settled = true
          }
          Object.assign(outcome, { outcome: 'success', provider, resultCount: result.results.length })
          return { provider, ...result }
        } finally {
          if (reservationId && !settled) {
            const held = reservationId
            await timer.time('releaseMs', () => releaseMeteredBudget(held)).catch(() => {
              request.log.warn({ provider, reservationId }, 'Search reservation cleanup failed')
            })
          }
        }
      }
      if (empty) {
        Object.assign(outcome, { outcome: 'empty', provider: empty.provider, resultCount: 0 })
        // An empty answer may only mean the providers that could have answered did not.
        if (!failed.length && !budgetError) return empty
        const degraded: SearchDegraded = { ...(failed.length ? { failed } : {}), ...(budgetError ? { budget: true as const } : {}) }
        return { ...empty, degraded }
      }
      if (budgetError) {
        outcome.outcome = 'budget'
        throw budgetError
      }
      throw new AppError(502, 'search_failed', 'Search is temporarily unavailable. Try again.', 'server_error')
    } catch (error) {
      if (controller.signal.aborted) {
        outcome.outcome = 'cancelled'
        throw new AppError(408, 'search_cancelled', 'Search was cancelled')
      }
      throw error
    } finally {
      reply.raw.off('close', onClose)
      const durationMs = timer.elapsed()
      reply.header('server-timing', timer.serverTiming(durationMs))
      recordSearchRequest(request.log, {
        userId: user.id, kind: 'query', category: input.category, page: input.page, ...outcome, durationMs, timer,
        queryLength: input.query.length, filters: queryFilters(input, filters.explicit),
      })
    }
  })
}
