export const CACHED_CHAT_LOOKUP_WINDOW_MS = 50

/** A quick local hit can paint before sliding; slow/missing reads use the placeholder. */
export function chooseCachedChatOpening(localReady: Promise<boolean>, cached: () => void, fallback: () => void) {
  let pending = true
  const complete = (available: boolean) => {
    if (!pending) return
    pending = false
    clearTimeout(timer)
    if (available) cached(); else fallback()
  }
  const timer = setTimeout(() => complete(false), CACHED_CHAT_LOOKUP_WINDOW_MS)
  void localReady.then(complete, () => complete(false))
  return () => { pending = false; clearTimeout(timer) }
}
