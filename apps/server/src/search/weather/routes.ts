import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getConfig } from '../../config.js'
import { createWeatherClient, geonamesSource, supportsNws } from './forecast.js'
import { publicPlace, resolveWeatherLocation } from './geocoder.js'

const weatherQuery = z.object({ location: z.string().trim().min(1).max(150) }).strict()
let lookupWeather: ReturnType<typeof createWeatherClient> | undefined

async function lookup() {
  if (lookupWeather) return lookupWeather
  const { redis } = await import('../../redis.js')
  async function withinCacheDeadline<T>(request: () => Promise<T>): Promise<T> {
    if (redis.status !== 'ready') throw new Error('Weather cache is offline')
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Weather cache timed out')), 1250)
    })
    try { return await Promise.race([request(), deadline]) } finally { clearTimeout(timer) }
  }
  return lookupWeather ??= createWeatherClient({
    read: key => withinCacheDeadline(() => redis.get(key)),
    write: (key, value, ttlSeconds) => withinCacheDeadline(() => redis.set(key, value, 'EX', ttlSeconds)),
    lease: async (key, ttlMs) => await withinCacheDeadline(() => redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK',
  })
}

export function registerSearchWeatherRoute(
  app: FastifyInstance,
  authorize: (request: FastifyRequest, reply: FastifyReply) => unknown,
) {
  app.get('/api/search/weather', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    authorize(request, reply)
    const { location } = weatherQuery.parse(request.query)
    const resolution = await resolveWeatherLocation(location)
    const sources = [geonamesSource]
    if (resolution.status !== 'found') return { ...resolution, sources }
    const place = publicPlace(resolution.location)
    const contact = getConfig().SEARCH_WEATHER_MET_CONTACT
    const unavailable = { status: 'unavailable', place, sources } as const
    if (!contact && !supportsNws(resolution.location.countryCode)) return unavailable
    try {
      const weather = await lookup()
      const result = await weather(resolution.location, contact)
      if (result) return { status: 'forecast', place, ...result }
    } catch {
      request.log.warn('Weather lookup unavailable')
    }
    return unavailable
  })

  app.get('/api/search/weather/alerts', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    authorize(request, reply)
    reply.header('cache-control', 'no-store')
    const { location } = weatherQuery.parse(request.query)
    const resolution = await resolveWeatherLocation(location)
    const unavailable = { status: 'unavailable' } as const
    if (resolution.status !== 'found' || !supportsNws(resolution.location.countryCode)) return unavailable
    try {
      const weather = await lookup()
      const result = await weather.alertsFor(resolution.location)
      if (result) return { status: 'available', ...result }
    } catch {
      request.log.warn('Weather alerts unavailable')
    }
    return unavailable
  })
}
