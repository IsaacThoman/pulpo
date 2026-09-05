import { generationEventHasStartedOutput, generationOutputHasStarted } from './output-text.js'

/** Track first output separately from the provider's overall request timeout. */
export function firstTokenTimeout(controller: AbortController, timeoutMs?: number) {
  let error: Error | undefined
  let timer = timeoutMs === undefined ? undefined : setTimeout(() => {
    error = new Error('First-token timeout')
    controller.abort(error)
  }, timeoutMs)
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    clear,
    observe(type: string, event: unknown, output: unknown): boolean {
      const started = generationEventHasStartedOutput(type, event) || generationOutputHasStarted(output)
      if (started) clear()
      return started
    },
    get error() { return error },
    throwIfTimedOut() {
      // Some providers/SDKs end the iterator normally when its signal is aborted.
      if (error) throw error
    },
  }
}
