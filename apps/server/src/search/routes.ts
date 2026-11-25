import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { webToolProviderSchema, type WebToolProvider } from '@pulpo/contracts'
import { releaseMeteredBudget, reserveMeteredBudget, settleMeteredBudget } from '../accounting/service.js'
import type { ProviderSearchInput, SearchResults } from '../agent/search-results.js'
import { availableWebSearchProviders, billedPrice, createWebProviderClients } from '../agent/web-tools.js'
import { requireUser } from '../auth/service.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseWebToolsSettings } from '../settings/application-settings.js'

const categories = ['web', 'news', 'images'] as const
const dates = ['day', 'week', 'month', 'year'] as const
const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  providers: z.array(webToolProviderSchema).min(1).max(2)
    .refine((providers) => new Set(providers).size === providers.length, 'Choose different primary and fallback providers')
    .optional(),
  limit: z.number().int().min(1).max(20).default(10),
  category: z.enum(categories).default('web'),
  region: z.string().regex(/^[a-z]{2}$/i, 'Choose a two-letter country code').toUpperCase().optional(),
  date: z.enum(dates).optional(),
}).strict()

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
      providers: defaultOrder.map((id) => ({
        id, categories, dates, region: true, priceMicros: billedPrice(id, 'search', settings),
      })),
    }
  })

  app.post('/api/search/query', { bodyLimit: 4096, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = searchUser(request, reply)
    const input = searchInputSchema.parse(request.body)
    const settings = await readSearchSettings()
    const available = availableWebSearchProviders(settings)
    const providers = input.providers?.filter((provider) => available.includes(provider)) ?? available
    if (!providers.length) throw new AppError(503, 'search_provider_unavailable', 'No selected search provider is available', 'server_error')

    const clients = createWebProviderClients(settings, getConfig().ENCRYPTION_KEY)
    const providerInput: ProviderSearchInput = {
      query: input.query, limit: input.limit, category: input.category, region: input.region, timeRelative: input.date,
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
            result = await clients[provider]!.searchResults(providerInput, signal)
            signal.throwIfAborted()
          } catch {
            controller.signal.throwIfAborted()
            request.log.warn({ provider }, 'Search provider failed')
            continue
          }
          if (!result.results.length && !result.answer) {
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
