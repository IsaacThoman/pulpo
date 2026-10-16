import assert from 'node:assert/strict'

/** Validate the resolved app configuration before importing connection-owning modules. */
export function assertReplayBenchmarkEndpoint(redisUrl: string): void {
  const url = new URL(redisUrl)
  assert(url.protocol === 'redis:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    && url.port === '56389' && !url.search && !url.hash,
  'Use the effective disposable Redis benchmark endpoint on localhost port 56389 without URL options')
}
