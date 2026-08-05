type CacheWrite = () => Promise<void>

const tails = new Map<string, Promise<void>>()

/**
 * Keep SQLite writes ordered per account without putting them on the network
 * response path. A failed cache write never blocks the next reconciliation.
 */
export function enqueueCacheWrite(namespace: string, write: CacheWrite): void {
  const previous = tails.get(namespace) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(write)
  tails.set(namespace, current)
  const cleanup = () => {
    if (tails.get(namespace) === current) tails.delete(namespace)
  }
  void current.then(cleanup, (error) => {
    cleanup()
    console.warn('Pulpo cache write failed', error instanceof Error ? error.message : error)
  })
}

/** Test/lifecycle hook for waiting until a namespace is durable. */
export async function flushCacheWrites(namespace: string): Promise<void> {
  await tails.get(namespace)?.catch(() => undefined)
}

