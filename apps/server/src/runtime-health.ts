export async function checkReadiness(checks: Array<() => Promise<unknown>>, timeoutMs = 2_000): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(checks.map((check) => check())),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Readiness check timed out')), timeoutMs)
        timeout.unref()
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}
