/** Bounds the entire reserve/upload/confirm lifecycle, including retries. */
export function createUploadQueue(concurrency = 3) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid upload concurrency')
  let active = 0
  const waiting: Array<() => void> = []
  return async function enqueue<T>(upload: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const start = () => { active += 1; resolve() }
      if (active < concurrency) start()
      else waiting.push(start)
    })
    try {
      return await upload()
    } finally {
      active -= 1
      waiting.shift()?.()
    }
  }
}

/** Retry explicit server-capacity rejections while retaining the upload slot. */
export async function retryBusyUpload<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= 4 || !error || typeof error !== 'object' || !('status' in error) || error.status !== 503) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt))
    }
  }
}
