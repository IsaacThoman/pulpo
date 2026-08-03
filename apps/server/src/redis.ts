import { Redis } from 'ioredis'
import { getConfig } from './config.js'

export function createRedis(): Redis {
  return new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null })
}

export const redis = createRedis()
