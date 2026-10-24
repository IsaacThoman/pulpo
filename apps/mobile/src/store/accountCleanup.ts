/**
 * Work features do when an account's data is cleared (sign-out, account removal), registered by
 * the features themselves so the session store does not depend on them.
 */
const cleanups = new Set<(namespace: string) => Promise<void> | void>()

export function registerAccountCleanup(cleanup: (namespace: string) => Promise<void> | void): () => void {
  cleanups.add(cleanup)
  return () => cleanups.delete(cleanup)
}

/** Runs every registered cleanup; one failing does not stop the others. */
export async function runAccountCleanups(namespace: string): Promise<void> {
  await Promise.all([...cleanups].map(async (cleanup) => {
    try {
      await cleanup(namespace)
    } catch {
      // Clearing the account continues regardless.
    }
  }))
}
