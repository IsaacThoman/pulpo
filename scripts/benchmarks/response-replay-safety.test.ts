import { describe, expect, it } from 'vitest'
import { parseConfig } from '../../apps/server/src/config.js'
import { assertReplayBenchmarkEndpoint } from './response-replay-safety.js'

describe('replay benchmark endpoint safety', () => {
  it.each(['redis://127.0.0.1:56389', 'redis://localhost:56389/0'])('accepts the effective disposable endpoint %s', (REDIS_URL) => {
    expect(() => assertReplayBenchmarkEndpoint(parseConfig({ REDIS_URL }).REDIS_URL)).not.toThrow()
  })

  it('rejects preview configuration rewriting an otherwise accepted raw loopback URL', () => {
    const REDIS_URL = 'redis://127.0.0.1:56389'
    expect(() => assertReplayBenchmarkEndpoint(REDIS_URL)).not.toThrow()
    const config = parseConfig({ REDIS_URL, COOLIFY_BRANCH: 'pull/832/head' })
    expect(config.REDIS_URL).toBe('redis://redis-pr-832:6379')
    expect(() => assertReplayBenchmarkEndpoint(config.REDIS_URL)).toThrow(/effective disposable Redis/)
  })

  it.each([
    'redis://redis-pr-832:6379', 'redis://127.0.0.1:6379', 'redis://example.com:56389',
    'https://127.0.0.1:56389', 'redis://127.0.0.1:56389?path=/tmp/other-redis.sock',
  ])('rejects nonbenchmark endpoints or connection overrides: %s', (url) => {
    expect(() => assertReplayBenchmarkEndpoint(url)).toThrow()
  })
})
